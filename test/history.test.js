'use strict';

// History of published end dates (src/history.js). Small fixtures only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { emptyHistory, recordBuild, flagShortened, rowKey, changed } = require('../src/history');

const FIX = path.join(__dirname, 'fixtures', 'history');
const build = (n) => JSON.parse(fs.readFileSync(path.join(FIX, `build-${n}.json`), 'utf8'));
const record = (h, n) => { const b = build(n); return recordBuild(h, b.devices, b.generated); };
const find = (h, model, hw) => h.rows.find((r) => r.model === model && r.hw_version === hw);
const seeded = () => record(record(record(emptyHistory(), 1), 2), 3);

test('history: one entry per key on the first build', () => {
  const h = record(emptyHistory(), 1);
  assert.strictEqual(h.generated, '2026-01-10');
  assert.strictEqual(h.rows.length, 3);
  for (const r of h.rows) {
    assert.strictEqual(r.dates.length, 1);
    assert.strictEqual(r.shortened, false);
    assert.deepStrictEqual([r.dates[0].first_seen, r.dates[0].last_seen], ['2026-01-10', null]); // still current
  }
  assert.strictEqual(find(h, 'C20', null).dates[0].support_end, null);
});

test('history: a changed date is appended and closes the previous one; an unchanged one stays current', () => {
  const h = seeded();
  const v1 = find(h, 'R100', 'V1');
  assert.deepStrictEqual(v1.dates.map((d) => [d.support_end, d.first_seen, d.last_seen]), [
    ['2030-12-31', '2026-01-10', '2026-01-10'],
    ['2029-12-31', '2026-02-14', null],
  ]);
  // The source text and URL are those recorded when the date was first seen.
  assert.strictEqual(v1.dates[1].support_end_raw, '31 December 2029');
  assert.strictEqual(v1.dates[1].source_url, 'https://example.com/psti-v2');
  // Spelling follows the latest build; the key is case-insensitive.
  assert.strictEqual(v1.vendor, 'ACME');
  assert.strictEqual(h.generated, '2026-03-01');
});

test('history: an earlier end date is flagged as shortened', () => {
  const h = seeded();
  const v1 = find(h, 'R100', 'V1');
  assert.strictEqual(v1.shortened, true);
  assert.strictEqual(v1.dates[1].shortened, true);
  assert.ok(!('shortened' in v1.dates[0]));
  // V2: extended to 2032, then back to 2031: shorter than 2032.
  const v2 = find(h, 'R100', 'V2');
  assert.deepStrictEqual(v2.dates.map((d) => d.support_end), ['2031-06-30', '2032-06-30', '2031-06-30']);
  assert.deepStrictEqual(v2.dates.map((d) => !!d.shortened), [false, false, true]);
  assert.strictEqual(v2.shortened, true);
  // A later date is not a shortening.
  assert.strictEqual(find(record(record(emptyHistory(), 1), 2), 'R100', 'V2').shortened, false);
});

test('history: rows that leave the dataset keep their history', () => {
  const h = seeded();
  const c20 = find(h, 'C20', null);
  assert.ok(c20);
  assert.strictEqual(c20.dates[0].last_seen, '2026-01-10');
  assert.strictEqual(h.rows.length, 4);
  assert.deepStrictEqual(changed(h).map((r) => `${r.model} ${r.hw_version}`).sort(), ['R100 V1', 'R100 V2']);
});

test('history: rebuilding the same dataset changes nothing', () => {
  const h = seeded();
  const before = JSON.stringify(h);
  record(h, 3);
  assert.strictEqual(JSON.stringify(h), before);
});

test('history: a build older than the history is refused when a date changed', () => {
  const h = seeded();
  const b = build(1);
  assert.throws(() => recordBuild(h, b.devices, '2026-02-20'), /older than the history/);
  assert.throws(() => recordBuild(h, b.devices, 'yesterday'), /bad dataset date/);
});

test('history: a correction is never shortened and resets the comparison', () => {
  const h = seeded();
  const v1 = find(h, 'R100', 'V1');
  v1.dates[1].correction = true;
  v1.dates[1].note = 'Read from the wrong column before.';
  flagShortened(v1);
  assert.strictEqual(v1.shortened, false);
  assert.ok(!('shortened' in v1.dates[1]));
  // A new build keeps the hand-written fields.
  const b = build(3);
  b.devices[0].support_end = '2029-06-30';
  recordBuild(h, b.devices, '2026-04-01');
  assert.strictEqual(v1.dates[1].note, 'Read from the wrong column before.');
  assert.strictEqual(v1.dates[2].shortened, true); // earlier than 2029-12-31, the corrected date
  assert.strictEqual(v1.shortened, true);
});

test('history: keys match the build script (vendor, model, hardware version, region)', () => {
  assert.strictEqual(rowKey({ vendor: 'Acme', model: 'R100', hw_version: null, region: 'UK' }), 'acme|r100||uk');
  assert.strictEqual(rowKey({ vendor: 'Acme', model: 'R100', hw_version: 'V1' }), 'acme|r100|v1|global');
});

test('history: data/history.json covers every row of data/devices.json', () => {
  const root = path.join(__dirname, '..');
  const history = JSON.parse(fs.readFileSync(path.join(root, 'data', 'history.json'), 'utf8'));
  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data', 'devices.json'), 'utf8'));
  const byKey = new Map(history.rows.map((r) => [rowKey(r), r]));
  for (const d of dataset.devices) {
    const r = byKey.get(rowKey(d));
    assert.ok(r, `${rowKey(d)} missing from history`);
    assert.strictEqual(r.dates[r.dates.length - 1].support_end, d.support_end, rowKey(d));
  }
  for (const r of history.rows) {
    r.dates.forEach((d, i) => {
      const current = i === r.dates.length - 1 && byKey.get(rowKey(r)) && dataset.devices.some((x) => rowKey(x) === rowKey(r));
      if (d.last_seen === null) assert.ok(i === r.dates.length - 1, `${rowKey(r)}: only the latest date can be current`);
      else assert.ok(d.first_seen <= d.last_seen && d.last_seen <= history.generated);
      if (current) assert.strictEqual(d.last_seen, null, `${rowKey(r)}: current date should have last_seen null`);
    });
    assert.strictEqual(r.shortened, r.dates.some((d) => d.shortened === true));
  }
});
