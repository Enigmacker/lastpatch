'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { qnapRows, linksysTable, linksysRows, linksysCategory, linksysDate } = require('../scripts/update-vendor-lists');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'vendor-lists', f), 'utf8');

test('QNAP feed: dated, month-only and EOL rows kept; active and accessories skipped', () => {
  const rows = qnapRows(JSON.parse(fixture('qnap.json')), '2026-11-11');
  assert.deepStrictEqual(rows.map((r) => [r.model, r.category, r.support_end]), [
    ['QHora-301W', 'router', '2030-06-30'],
    ['TS-128', 'nas', null],
    ['TS-231P', 'nas', '2024-10-31'],
    ['TS-253D', 'nas', '2027-12-31'],
  ]);
  assert.strictEqual(rows[2].support_end_raw, 'Technical Support and Security Updates: 2024-10');
  assert.strictEqual(rows[0].source_date, '2026-11-11');
});

test('Linksys table: parsed, grouped per model, hardware version and market', () => {
  const table = linksysTable(fixture('productTable.js'));
  assert.strictEqual(table.length, 5);
  const rows = linksysRows(table, '2026-11-11');
  assert.deepStrictEqual(rows.map((r) => [r.model, r.hw_version, r.region, r.category, r.support_end]), [
    ['EA7500', 'V3', 'EMEA', 'router', '2023-01-28'],
    ['RE7000', null, 'APAC', 'repeater', '2025-04-14'],
    ['WHW0301', null, 'CA', 'mesh', '2028-11-04'],
  ]);
  assert.match(rows[0].support_end_raw, /EA7500V3-ME, EA7500V3-UK/);
});

test('Linksys helpers', () => {
  assert.strictEqual(linksysDate('9-Aug-2025'), '2025-08-09');
  assert.strictEqual(linksysDate('n/a'), null);
  assert.strictEqual(linksysCategory('Power adapter'), null);
  assert.strictEqual(linksysCategory('DOCSIS 3.0 CABLE MODEM'), 'modem');
});
