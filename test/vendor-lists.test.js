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

test('WatchGuard page: Firebox, XTM and access points with their End of Life date', () => {
  const { watchguardRows } = require('../scripts/update-vendor-lists');
  const rows = watchguardRows(fixture('watchguard.html'));
  assert.deepStrictEqual(rows.map((r) => [r.model, r.category, r.support_end]), [
    ['Firebox T15', 'router', '2027-03-01'],
    ['Firebox T80', 'router', '2028-07-01'],
    ['XTM 850', 'router', '2023-12-31'],
    ['AP225W', 'other', '2026-12-31'],
  ]);
});

test('Meraki page: hardware split per model, accessories, Go and undated rows left out', () => {
  const { merakiRows } = require('../scripts/update-vendor-lists');
  const rows = merakiRows(fixture('meraki.html'));
  assert.deepStrictEqual(rows.map((r) => [r.model, r.category, r.support_end]), [
    ['Meraki MS120 Series', 'switch', '2030-03-28'],
    ['Meraki MS220-8', 'switch', '2025-09-21'],
    ['Meraki MS220-8P', 'switch', '2025-09-21'],
    ['Meraki MR36', 'other', '2031-12-31'],
    ['Meraki MR36H', 'other', '2031-12-31'],
    ['Meraki MR44', 'other', '2031-12-31'],
    ['Meraki MR46', 'other', '2031-12-31'],
    ['Meraki MX64', 'router', '2027-07-26'],
    ['Meraki MX64W', 'router', '2027-07-26'],
    ['Meraki Z3C', 'router', '2029-09-04'],
    ['Meraki MV Gen 2 Cameras', 'camera', '2030-12-31'],
    ['Meraki Z1', 'router', '2025-07-27'],
  ]);
});

test('SonicWall table: End Of Support per model, rows without it skipped', () => {
  const { sonicwallRows, SONICWALL_PAGES } = require('../scripts/update-vendor-lists');
  const rows = sonicwallRows(fixture('sonicwall-tz.html'), SONICWALL_PAGES[0]);
  assert.deepStrictEqual(rows.map((r) => [r.model, r.support_end]), [['TZ 400W', '2026-08-01'], ['TZ SOHO W', '2026-04-16']]);
  assert.match(rows[0].support_end_raw, /from 2023-08-01/);
});

test('Brother list: dated blocks and the 2008-2025 block', () => {
  const { brotherRows } = require('../scripts/update-vendor-lists');
  const rows = brotherRows(fixture('brother.txt'), { url: 'https://example.test/b.pdf', region: 'EU', title: 'printers' });
  assert.deepStrictEqual(rows.map((r) => [r.model, r.support_end]), [
    ['MFC-J6935DW', '2026-01-31'], ['DCP-1610WR', '2026-03-31'], ['MFC-J985DW', '2026-03-31'],
    ['ADS-1100W', '2025-12-31'], ['HL-1210WR', '2025-12-31'],
  ]);
  assert.match(rows[3].support_end_raw, /2008-1-1 ~ 2025-12-31/);
});

test('Epson list: suffixes dropped from model names, duplicates removed, minimum dates', () => {
  const { epsonRows } = require('../scripts/update-vendor-lists');
  const rows = epsonRows(fixture('epson.txt'));
  assert.deepStrictEqual(rows.map((r) => [r.model, r.support_end]), [
    ['AM-C10000', '2033-03-31'], ['ET-811', '2033-03-31'], ['WF-7845', '2033-03-31'], ['EB-1480Fi', '2027-04-07'], ['TM-m30II', '2033-03-31'],
  ]);
  assert.ok(rows.every((r) => r.end_is_minimum));
});
