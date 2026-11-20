// Deploy this as a web app owned by the Hanekom Google account.
// Three duties, all token-gated:
//   1. Backup sink: appends quotation rows to the Quotations sheet.
//      Auth: BACKUP_TOKEN script property (server-to-server, never public).
//   2. Email relay: emails every website quotation request / enquiry to the
//      Hanekom sales addresses. Auth: EMAIL_RELAY_TOKEN script property
//      (this one lives in the public website JS, so it is rate-limited).
//   3. Sheet relay: the same email-relay request also appends the enquiry
//      to the Quotations sheet (one row per requested item), so every
//      submission is stored even when both Supabase projects are down.
//      Same EMAIL_RELAY_TOKEN, same 20/hour rate limit, same request_key +
//      line dedup as duty 1, so the two paths never store a line twice.
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
      const found = existingLines_(sheet, input.request_key);

      const toAppend = [];
      input.rows.forEach(row => {
        if (!Array.isArray(row) || row.length !== EXPECTED_COLUMNS ||
            row[2] !== input.request_key) throw new Error('Invalid backup row');
        const line = String(row[14]);
        if (found.existing.has(line)) return;
        found.existing.add(line);
        toAppend.push(row.map(safeCell_));
      });
      if (toAppend.length) {
        sheet.getRange(found.lastRow + 1, 1, toAppend.length, EXPECTED_COLUMNS).setValues(toAppend);
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

/* Collects the line numbers already stored for a request_key, so repeated
   pushes (website relay, Supabase sync worker, retries) each append a line
   only once. Reads columns 3-15 of every data row: column 3 is the request
   key, column 15 the line number. */
function existingLines_(sheet, requestKey) {
  const lastRow = sheet.getLastRow();
  const existing = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, 3, lastRow - 1, 13).getValues().forEach(row => {
      if (String(row[0]) === String(requestKey)) existing.add(String(row[12]));
    });
  }
  return { lastRow: lastRow, existing: existing };
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

  const kind = enq.inquiry_type === 'quotation' ? 'quotation request'
    : enq.inquiry_type === 'whatsapp_lead' ? 'WhatsApp lead' : 'enquiry';
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

  // Duty 3: store the same enquiry in the Quotations sheet. Best-effort -
  // the email has already gone out, so sheet problems are reported back but
  // never thrown.
  let sheetResult = { appended: 0 };
  try {
    sheetResult = appendEnquiryToSheet_(input.request_key || '', enq);
  } catch (sheetError) {
    sheetResult = { appended: 0, error: String(sheetError.message || sheetError) };
  }
  return reply_({ ok: true, emailed: true, sheet: sheetResult });
}

/* Duty 3 implementation: builds relay rows in the exact 26-column layout
   the Supabase sync worker uses (same column order as the Quotations sheet
   header), then appends them under the script lock with the shared
   request_key + line dedup. */
function appendEnquiryToSheet_(requestKey, enq) {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) return { appended: 0, error: 'SPREADSHEET_ID missing' };
  const rows = enquirySheetRows_(requestKey, enq);
  const key = rows[0][2];
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Quotations');
    if (!sheet) return { appended: 0, error: 'Quotations tab missing' };
    const found = existingLines_(sheet, key);
    const toAppend = [];
    rows.forEach(row => {
      if (found.existing.has(String(row[14]))) return;
      found.existing.add(String(row[14]));
      toAppend.push(row.map(safeCell_));
    });
    if (toAppend.length) {
      sheet.getRange(found.lastRow + 1, 1, toAppend.length, EXPECTED_COLUMNS).setValues(toAppend);
      SpreadsheetApp.flush();
    }
    return { appended: toAppend.length };
  } finally {
    lock.releaseLock();
  }
}

function enquirySheetRows_(requestKey, enq) {
  const now = new Date().toISOString();
  const key = requestKey || 'web-relay-' + now;
  const items = Array.isArray(enq.items) && enq.items.length
    ? enq.items
    : [{ product_code: '', product_name: enq.inquiry_type === 'quotation'
          ? '(no items selected)'
          : enq.inquiry_type === 'whatsapp_lead'
            ? '(WhatsApp lead \u2014 item discussed in chat)'
            : '(general enquiry)',
        description: '', quantity: 1, unit: 'each', selected_size: '',
        selected_colour: '', specifications: '' }];
  return items.map((item, index) => {
    const columns = [
      'direct', now, key,
      '', 'received', now,
      enq.company_name || '', enq.full_name || '',
      enq.email || '', enq.phone || '', enq.phone || '',
      enq.location || '', enq.preferred_channel || '',
      enq.message || '',
      index + 1,
      item.product_code || '', item.product_name || '',
      item.description || '', Number(item.quantity) || 1,
      item.unit || 'each', item.selected_size || '',
      item.selected_colour || '',
      item.specifications ||
        (item.product_code ? 'Website catalogue item: ' + item.product_code : ''),
      enq.currency || 'ZMW', '', ''
    ];
    if (columns.length !== EXPECTED_COLUMNS) throw new Error('Relay row column mismatch');
    return columns;
  });
}

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function enquiryEmailHtml_(enq, kind) {
  const who = enq.full_name || 'Not provided';
  const intro = kind === 'WhatsApp lead'
    ? 'New website WhatsApp lead from <strong>' + esc_(who) + '</strong> \u2014 they saved their details at a WhatsApp button; the product conversation continues in the WhatsApp chat.'
    : 'New website ' + esc_(kind) + ' from <strong>' + esc_(who) + '</strong>.';
  const rows = [
    ['Received', Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd HH:mm') + ' (CAT)'],
    ['Contact name', enq.full_name], ['Company name', enq.company_name],
    ['Business email', enq.email], ['Contact number', enq.phone],
    ['Address', enq.location], ['Industry / sector', enq.industry],
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
    '<p style="margin:0 0 4px">' + intro + '</p>' +
    '<table style="border-collapse:collapse;margin-top:10px">' + rows + '</table>' +
    itemsHtml + msg +
    (enq.page_url ? '<p style="margin-top:14px;color:#999;font-size:12px">Source: ' + esc_(enq.page_url) + '</p>' : '') +
    '</div>';
}

function enquiryEmailText_(enq, kind) {
  const lines = kind === 'WhatsApp lead'
    ? ['Website WhatsApp lead (sent by the website email relay)',
       'The visitor saved their contact details at a WhatsApp button; the product conversation continues in the WhatsApp chat.', '']
    : ['Website ' + kind + ' (sent by the website email relay)', ''];
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
  [['Contact name', enq.full_name], ['Company name', enq.company_name], ['Business email', enq.email],
   ['Contact number', enq.phone], ['Address', enq.location],
   ['Industry / sector', enq.industry], ['Preferred contact', enq.preferred_channel]]
    .forEach(r => { if (r[1]) lines.push(r[0] + ': ' + r[1]); });
  if (enq.message) lines.push('', 'Message:', enq.message);
  return lines.join('\n');
}

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
