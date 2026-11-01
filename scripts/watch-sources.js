#!/usr/bin/env node
'use strict';

// Watch the official documents the dataset is built from.
//
//   node scripts/watch-sources.js [--report report.md] [--update]
//
// For every source URL in data/devices.json, and every index page in
// data/source-indexes.json, download the document and compare a fingerprint
// with data/sources-state.json:
//   - PDF and other files: SHA-256 of the bytes;
//   - HTML pages: SHA-256 of the visible text (scripts, styles and tags
//     removed), so layout or tracking changes do not raise alerts;
//   - index pages: the sorted list of matching document links.
// Sources seen for the first time are recorded as a baseline, not reported.
// --update records the new fingerprints (after the dataset was reviewed).
// Exit code: 0 always (the report says what changed); 1 on usage errors.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEVICES = path.join(ROOT, 'data', 'devices.json');
const INDEXES = path.join(ROOT, 'data', 'source-indexes.json');
const STATE = path.join(ROOT, 'data', 'sources-state.json');
const HISTORY_MAX = 20;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function visibleText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html, baseUrl, pattern) {
  const re = new RegExp(pattern, 'i');
  const links = new Set();
  for (const m of String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let href;
    try { href = new URL(m[1].replace(/&amp;/g, '&'), baseUrl).href; } catch { continue; }
    if (re.test(decodeURIComponent(href))) links.add(href);
  }
  return [...links].sort();
}

function sourcesFromDataset(devices) {
  const byUrl = new Map();
  for (const d of devices) {
    if (!byUrl.has(d.source_url)) byUrl.set(d.source_url, { vendor: d.vendor, url: d.source_url, rows: 0 });
    byUrl.get(d.source_url).rows++;
  }
  return [...byUrl.values()];
}

async function defaultFetch(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
    headers: { 'User-Agent': 'lastpatch-source-watch (+https://github.com/Enigmacker/lastpatch)' },
  });
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, body: buf };
}

// Fingerprint one source. Returns { fingerprint, kind, links?, error? }.
async function fingerprint(source, fetcher) {
  let res;
  try { res = await fetcher(source.url); } catch (err) { return { error: err.message || String(err) }; }
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  if (source.link_pattern) {
    const links = extractLinks(res.body.toString('utf8'), source.url, source.link_pattern);
    return { kind: 'links', fingerprint: sha256(links.join('\n')), links };
  }
  const isHtml = /html/i.test(res.type) && !/\.pdf(\?|$)/i.test(source.url);
  if (isHtml) {
    const text = visibleText(res.body.toString('utf8'));
    return { kind: 'text', fingerprint: sha256(text), size: text.length };
  }
  return { kind: 'bytes', fingerprint: sha256(res.body), size: res.body.length };
}

// Compare fresh fingerprints with the stored state.
function compare(sources, results, state, today) {
  const changes = [];
  const errors = [];
  const baseline = [];
  const next = JSON.parse(JSON.stringify(state));
  sources.forEach((s, i) => {
    const r = results[i];
    const prev = state[s.url];
    if (r.error) {
      errors.push({ source: s, error: r.error });
      return;
    }
    if (!prev) {
      baseline.push(s);
      next[s.url] = { vendor: s.vendor, kind: r.kind, fingerprint: r.fingerprint, links: r.links, first_seen: today, history: [{ date: today, fingerprint: r.fingerprint }] };
      return;
    }
    if (prev.fingerprint !== r.fingerprint) {
      const change = { source: s, kind: r.kind };
      if (r.kind === 'links') {
        const before = new Set(prev.links || []);
        const after = new Set(r.links || []);
        change.added = [...after].filter((l) => !before.has(l));
        change.removed = [...before].filter((l) => !after.has(l));
      }
      changes.push(change);
      next[s.url].pending = { date: today, fingerprint: r.fingerprint, links: r.links };
    } else {
      delete next[s.url].pending;
    }
  });
  return { changes, errors, baseline, next };
}

// Accept pending fingerprints (after the dataset has been reviewed).
function accept(state, today) {
  for (const entry of Object.values(state)) {
    if (!entry.pending) continue;
    entry.fingerprint = entry.pending.fingerprint;
    if (entry.pending.links) entry.links = entry.pending.links;
    entry.history = [...(entry.history || []), { date: today, fingerprint: entry.fingerprint }].slice(-HISTORY_MAX);
    delete entry.pending;
  }
  return state;
}

function report({ changes, errors, baseline }, today) {
  const lines = [`# Official source check, ${today}`, ''];
  if (!changes.length && !errors.length) lines.push('No official source changed.');
  if (changes.length) {
    lines.push(`## ${changes.length} source(s) changed`, '', 'Review the dataset rows taken from each source, update `raw/`, rebuild, then run `node scripts/watch-sources.js --update`.', '');
    for (const c of changes) {
      lines.push(`- **${c.source.vendor}**: ${c.source.url}${c.source.rows ? ` (${c.source.rows} rows in the dataset)` : ''}`);
      for (const l of c.added || []) lines.push(`  - new document linked: ${l}`);
      for (const l of c.removed || []) lines.push(`  - document no longer linked: ${l}`);
    }
    lines.push('');
  }
  if (errors.length) {
    lines.push(`## ${errors.length} source(s) could not be checked`, '', 'A source that keeps failing may have moved: find its new official location.', '');
    for (const e of errors) lines.push(`- **${e.source.vendor}**: ${e.source.url} (${e.error})`);
    lines.push('');
  }
  if (baseline.length) lines.push(`${baseline.length} source(s) recorded for the first time.`);
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const reportFile = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
  const today = new Date().toISOString().slice(0, 10);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* first run */ }

  if (args.includes('--update')) {
    fs.writeFileSync(STATE, JSON.stringify(accept(state, today), null, 2) + '\n');
    console.log('Pending source fingerprints accepted.');
    return;
  }

  const devices = JSON.parse(fs.readFileSync(DEVICES, 'utf8')).devices;
  const indexes = JSON.parse(fs.readFileSync(INDEXES, 'utf8')).indexes;
  const sources = [...sourcesFromDataset(devices), ...indexes];

  const results = [];
  for (const s of sources) { // sequential: be polite to vendor sites
    results.push(await fingerprint(s, defaultFetch));
  }
  const outcome = compare(sources, results, state, today);
  fs.writeFileSync(STATE, JSON.stringify(outcome.next, null, 2) + '\n');
  const text = report(outcome, today);
  if (reportFile) fs.writeFileSync(reportFile, text);
  process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${outcome.changes.length}\nerrors=${outcome.errors.length}\nbaseline=${outcome.baseline.length}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}

module.exports = { visibleText, extractLinks, sourcesFromDataset, fingerprint, compare, accept, report };
