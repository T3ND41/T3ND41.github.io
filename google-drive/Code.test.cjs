const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = [['Request Key', 'Line']];
const cells = [];
const sheet = {
  getLastRow: () => values.length,
  getRange: (startRow, startColumn, rowCount, columnCount) => ({
    getValues: () => values.slice(startRow - 1, startRow - 1 + rowCount)
      .map(row => Array.from({ length: columnCount }, (_, i) => row[startColumn - 1 + i] ?? '')),
    setValues: rows => { cells.push(...rows); values.push(...rows); },
  }),
};
const context = {
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => ({ BACKUP_TOKEN: 'secret', SPREADSHEET_ID: 'sheet' })[key],
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush: () => {} },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }),
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'Code.gs'), 'utf8'), context);

function send(token, rows) {
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
    token, request_key: 'quote-1', rows,
  }) } }).text);
}

const row1 = Array(26).fill('');
row1[2] = 'quote-1';
row1[14] = 1;
row1[17] = '=IMPORTXML("bad")';
const row2 = [...row1];
row2[14] = 2;

assert.equal(send('wrong', [row1]).ok, false);
assert.equal(send('secret', [row1, row2]).appended, 2);
assert.equal(cells[0][17], "'=IMPORTXML(\"bad\")");
assert.equal(send('secret', [row1, row2]).appended, 0);
assert.equal(cells.length, 2);
console.log('Google Sheet receiver: authorization, escaping and retry idempotency passed');
