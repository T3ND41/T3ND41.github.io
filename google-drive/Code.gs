// Deploy this as a web app owned by the Hanekom Google account.
// Two duties, both token-gated:
//   1. Backup sink: appends quotation rows to the Quotations sheet.
//      Auth: BACKUP_TOKEN script property (server-to-server, never public).
//   2. Email relay: emails every website quotation request / enquiry to the
//      Hanekom sales addresses. Auth: EMAIL_RELAY_TOKEN script property
//      (this one lives in the public website JS, so it is rate-limited).
const EXPECTED_COLUMNS = 26;
const EMAIL_RELAY_RECIPIENTS = 'sales@hanekom.co.zm,hanekominnovationsltd@gmail.com';
const EMAIL_RELAY_MAX_PER_HOUR = 20;

function doPost(e) {
  try {
    const input = JSON.parse(e.postData.contents);
    if (input.type === 'email_notification') return handleEmailRelay_(input);
    const properties = PropertiesService.getScriptProperties();
    const expectedToken = properties.getProperty('BACKUP_TOKEN');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!expectedToken || !spreadsheetId || input.token !== expectedToken) {
      throw new Error('Unauthorized');
    }
    if (!input.request_key || typeof input.request_key !== 'string' ||
        !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 100) {
      throw new Error('Invalid backup request');
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Quotations');
      if (!sheet) throw new Error('Quotations tab missing');
      const lastRow = sheet.getLastRow();
      const existing = new Set();
      if (lastRow > 1) {
        const keysAndLines = sheet.getRange(2, 3, lastRow - 1, 13).getValues();
        keysAndLines.forEach(row => {
          if (String(row[0]) === input.request_key) existing.add(String(row[12]));
        });
      }

      const toAppend = [];
      input.rows.forEach(row => {
        if (!Array.isArray(row) || row.length !== EXPECTED_COLUMNS ||
            row[2] !== input.request_key) throw new Error('Invalid backup row');
        const line = String(row[14]);
        if (existing.has(line)) return;
        existing.add(line);
        toAppend.push(row.map(safeCell_));
      });
      if (toAppend.length) {
        sheet.getRange(lastRow + 1, 1, toAppend.length, EXPECTED_COLUMNS).setValues(toAppend);
        SpreadsheetApp.flush();
      }
      return reply_({ ok: true, request_key: input.request_key, appended: toAppend.length });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return reply_({ ok: false, error: String(error.message || error) });
  }
}

function safeCell_(value) {
  if (typeof value === 'number') return value;
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

/* ---- email relay ----
   Emails the customer's enquiry to the Hanekom sales addresses straight
   from this Google account (free, no third-party mail API needed). */
function handleEmailRelay_(input) {
  const properties = PropertiesService.getScriptProperties();
  const expectedToken = properties.getProperty('EMAIL_RELAY_TOKEN');
  if (!expectedToken || input.token !== expectedToken) {
    throw new Error('Unauthorized');
  }
  const enq = input.enquiry;
  if (!enq || typeof enq !== 'object') throw new Error('Invalid enquiry');

  // Public-token rate limit: at most EMAIL_RELAY_MAX_PER_HOUR emails per hour.
  const cache = CacheService.getScriptCache();
  const bucket = 'relay_' + Math.floor(Date.now() / 3600000);
  const count = Number(cache.get(bucket) || 0);
  if (count >= EMAIL_RELAY_MAX_PER_HOUR) {
    return reply_({ ok: false, error: 'rate_limited' });
  }
  cache.put(bucket, String(count + 1), 3700);

  const kind = enq.inquiry_type === 'quotation' ? 'quotation request' : 'enquiry';
  const who = enq.full_name || 'Not provided';
  const subject = 'Website ' + kind + ' \u2014 ' + who +
    (enq.company_name ? ' (' + enq.company_name + ')' : '');
  const opts = {
    to: EMAIL_RELAY_RECIPIENTS,
    subject: subject,
    htmlBody: enquiryEmailHtml_(enq, kind),
    body: enquiryEmailText_(enq, kind)
  };
  if (enq.email && String(enq.email).indexOf('@') > 0) opts.replyTo = enq.email;
  MailApp.sendEmail(opts);
  return reply_({ ok: true, emailed: true });
}

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function enquiryEmailHtml_(enq, kind) {
  const rows = [
    ['Received', Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd HH:mm') + ' (CAT)'],
    ['Name', enq.full_name], ['Company', enq.company_name],
    ['Email', enq.email], ['Phone / WhatsApp', enq.phone],
    ['Town / delivery location', enq.location], ['Industry / sector', enq.industry],
    ['Preferred contact', enq.preferred_channel]
  ].map(r => (r[1] ? '<tr><td style="padding:4px 14px 4px 0;color:#666;white-space:nowrap">' +
    esc_(r[0]) + '</td><td style="padding:4px 0"><strong>' + esc_(r[1]) + '</strong></td></tr>' : '')).join('');
  let itemsHtml = '';
  if (Array.isArray(enq.items) && enq.items.length) {
    const rows2 = enq.items.map(it => {
      const spec = [it.selected_size, it.selected_colour].filter(Boolean).join(', ');
      const line = esc_((it.quantity || 1) + ' \u00d7 ' + (it.product_name || it.product_code || 'item')) +
        (spec ? ' <span style="color:#666">(' + esc_(spec) + ')</span>' : '') +
        (it.product_code ? '<br><span style="color:#666;font-size:12px">Catalogue code: ' + esc_(it.product_code) + '</span>' : '') +
        (it.product_url ? '<br><a href="' + esc_(it.product_url) + '">Product page</a>' : '') +
        (it.image_url ? ' \u00b7 <a href="' + esc_(it.image_url) + '">Photo</a>' : '');
      return '<li style="margin-bottom:10px">' + line + '</li>';
    }).join('');
    itemsHtml = '<h3 style="margin:18px 0 6px;font-size:14px">Requested items</h3><ul style="padding-left:18px;margin:0">' + rows2 + '</ul>';
  }
  const msg = enq.message ? '<h3 style="margin:18px 0 6px;font-size:14px">Message</h3><p style="white-space:pre-wrap;margin:0">' + esc_(enq.message) + '</p>' : '';
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p style="margin:0 0 4px">New website ' + esc_(kind) + ' from <strong>' + esc_(who) + '</strong>.</p>' +
    '<table style="border-collapse:collapse;margin-top:10px">' + rows + '</table>' +
    itemsHtml + msg +
    (enq.page_url ? '<p style="margin-top:14px;color:#999;font-size:12px">Source: ' + esc_(enq.page_url) + '</p>' : '') +
    '</div>';
}

function enquiryEmailText_(enq, kind) {
  const lines = ['Website ' + kind + ' (sent by the website email relay)', ''];
  if (Array.isArray(enq.items) && enq.items.length) {
    lines.push('Requested items:');
    enq.items.forEach(it => {
      const spec = [it.selected_size, it.selected_colour].filter(Boolean).join(', ');
      lines.push('- ' + (it.quantity || 1) + ' x ' + (it.product_name || it.product_code || 'item') + (spec ? ' (' + spec + ')' : ''));
      if (it.product_code) lines.push('  Catalogue code: ' + it.product_code);
      if (it.product_url) lines.push('  Product page: ' + it.product_url);
      if (it.image_url) lines.push('  Photo: ' + it.image_url);
    });
    lines.push('');
  }
  [['Name', enq.full_name], ['Company', enq.company_name], ['Email', enq.email],
   ['Phone / WhatsApp', enq.phone], ['Town / delivery location', enq.location],
   ['Industry / sector', enq.industry], ['Preferred contact', enq.preferred_channel]]
    .forEach(r => { if (r[1]) lines.push(r[0] + ': ' + r[1]); });
  if (enq.message) lines.push('', 'Message:', enq.message);
  return lines.join('\n');
}

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
