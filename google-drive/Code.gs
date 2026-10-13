// Deploy this as a web app owned by the Hanekom Google account.
const EXPECTED_COLUMNS = 26;

function doPost(e) {
  try {
    const input = JSON.parse(e.postData.contents);
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

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
