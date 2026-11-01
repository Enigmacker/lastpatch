'use strict';

const test = require('node:test');
const assert = require('node:assert');
const w = require('../scripts/watch-sources');

const page = (body, type = 'text/html; charset=utf-8') => ({ status: 200, type, body: Buffer.from(body) });

test('visible text ignores scripts, styles and markup', () => {
  const a = w.visibleText('<html><script>var t=1</script><p>Model A  until <b>2029</b></p></html>');
  const b = w.visibleText('<html><script>var t=2</script><style>p{}</style><div>Model A until 2029</div></html>');
  assert.strictEqual(a, b);
});

test('document links on an index page', () => {
  const links = w.extractLinks(
    '<a href="/docs/Statements%20of%20PSTI%20Compliance_TP-Link.pdf">PSTI</a><a href="/other.pdf">x</a><a href="manual.html">m</a>',
    'https://example.com/uk/support/psti/', 'PSTI.*\\.pdf');
  assert.deepStrictEqual(links, ['https://example.com/docs/Statements%20of%20PSTI%20Compliance_TP-Link.pdf']);
});

test('one source per URL, with its row count', () => {
  const s = w.sourcesFromDataset([
    { vendor: 'AVM', source_url: 'https://a/1' },
    { vendor: 'AVM', source_url: 'https://a/1' },
    { vendor: 'ASUS', source_url: 'https://b/2' },
  ]);
  assert.deepStrictEqual(s.map((x) => [x.url, x.rows]), [['https://a/1', 2], ['https://b/2', 1]]);
});

test('baseline, unchanged, changed, error', async () => {
  const sources = [
    { vendor: 'AVM', url: 'https://a/page', rows: 3 },
    { vendor: 'TP-Link', url: 'https://t/doc.pdf', rows: 10 },
    { vendor: 'TP-Link', url: 'https://t/index', link_pattern: 'PSTI.*\\.pdf' },
    { vendor: 'Gone', url: 'https://g/x' },
  ];
  const v1 = {
    'https://a/page': page('<p>FRITZ!Box 7590 01.10.2029</p>'),
    'https://t/doc.pdf': page('%PDF-1 v1', 'application/pdf'),
    'https://t/index': page('<a href="PSTI_2026_09.pdf">x</a>'),
    'https://g/x': { status: 404, type: '', body: Buffer.from('') },
  };
  const run = async (pages) => Promise.all(sources.map((s) => w.fingerprint(s, async (u) => pages[u])));

  const first = w.compare(sources, await run(v1), {}, '2026-11-01');
  assert.strictEqual(first.baseline.length, 3);
  assert.strictEqual(first.changes.length, 0);
  assert.strictEqual(first.errors.length, 1);

  // Same content with a different script: no alert.
  const v2 = { ...v1, 'https://a/page': page('<script>x()</script><p>FRITZ!Box 7590 01.10.2029</p>') };
  const second = w.compare(sources, await run(v2), first.next, '2026-11-08');
  assert.strictEqual(second.changes.length, 0);

  // Date changed on the page, new PDF on the index: two alerts.
  const v3 = {
    ...v1,
    'https://a/page': page('<p>FRITZ!Box 7590 01.10.2030</p>'),
    'https://t/index': page('<a href="PSTI_2026_09.pdf">x</a><a href="PSTI_2026_12.pdf">y</a>'),
  };
  const third = w.compare(sources, await run(v3), second.next, '2026-11-15');
  assert.strictEqual(third.changes.length, 2);
  const idx = third.changes.find((c) => c.kind === 'links');
  assert.deepStrictEqual(idx.added, ['https://t/PSTI_2026_12.pdf']);
  assert.match(w.report(third, '2026-11-15'), /2 source\(s\) changed/);
  assert.match(w.report(third, '2026-11-15'), /new document linked: https:\/\/t\/PSTI_2026_12\.pdf/);

  // Still reported until accepted; then quiet, with history kept.
  const fourth = w.compare(sources, await run(v3), third.next, '2026-11-22');
  assert.strictEqual(fourth.changes.length, 2);
  const accepted = w.accept(fourth.next, '2026-11-23');
  assert.strictEqual(accepted['https://a/page'].history.length, 2);
  const fifth = w.compare(sources, await run(v3), accepted, '2026-11-29');
  assert.strictEqual(fifth.changes.length, 0);
});

test('network failure is an error, not a crash', async () => {
  const r = await w.fingerprint({ url: 'https://x' }, async () => { throw new Error('ECONNRESET'); });
  assert.strictEqual(r.error, 'ECONNRESET');
});
