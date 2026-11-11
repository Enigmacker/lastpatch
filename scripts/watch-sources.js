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
//   - HTML pages: SHA-256 of the lines that matter, those naming a model or
//     an end date the dataset took from the page, so menus, related
//     articles, banners and other page furniture do not raise alerts. A
//     change lists the lines added and removed;
//   - index pages: the sorted list of matching document links.
// Sources seen for the first time are recorded as a baseline, not reported.
// A page whose rows are not in its HTML (filled in by a script) is listed as
// needing a browser check. A source that keeps failing is reported once, then
// summarised, so the weekly issue only grows with news.
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

// Visible text, one line per block (paragraph, list item, table cell...).
function textLines(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|tr|table|thead|tbody|h[1-6]|section|article|header|footer|nav|aside|main|form|dd|dt|dl|caption|figcaption|figure|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/^[\s|]+|[\s|]+$/g, '').trim())
    .filter(Boolean);
}

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// The lines of a page that carry what the dataset took from it: a line is
// kept when it names one of the page's models or repeats one of its dates.
// Model names shorter than 4 characters ("Go", "Q") are too common to use.
function relevantLines(lines, source) {
  const models = [...(source.models || [])].map(squash).filter((m) => m.length >= 4);
  const raws = [...(source.raws || [])].map(squash).filter((r) => r.length >= 6);
  const keep = new Set();
  for (const line of lines) {
    const flat = squash(line);
    if (models.some((m) => flat.includes(m)) || raws.some((r) => flat.includes(r))) keep.add(line.slice(0, 300));
  }
  return [...keep].sort().slice(0, 1500);
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
    if (!byUrl.has(d.source_url)) byUrl.set(d.source_url, { vendor: d.vendor, url: d.source_url, rows: 0, models: new Set(), raws: new Set() });
    const s = byUrl.get(d.source_url);
    s.rows++;
    s.models.add(d.model);
    if (d.support_end_raw) s.raws.add(d.support_end_raw);
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
  if (isHtml && source.models) {
    const lines = relevantLines(textLines(res.body.toString('utf8')), source);
    return { kind: 'rows', fingerprint: sha256(lines.join('\n')), lines, unreadable: lines.length === 0 };
  }
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
  const stillFailing = [];
  const baseline = [];
  const rebaselined = [];
  const unreadable = [];
  const next = JSON.parse(JSON.stringify(state));
  sources.forEach((s, i) => {
    const r = results[i];
    const prev = state[s.url];
    if (r.error) {
      const failures = (prev?.failures || 0) + 1;
      const entry = next[s.url] || (next[s.url] = { vendor: s.vendor });
      entry.failures = failures;
      entry.failing_since = prev?.failing_since || today;
      (failures === 1 ? errors : stillFailing).push({ source: s, error: r.error, since: entry.failing_since });
      return;
    }
    if (r.unreadable) unreadable.push(s);
    const fresh = { vendor: s.vendor, kind: r.kind, fingerprint: r.fingerprint, links: r.links, lines: r.lines };
    // First sight, or a fingerprint method that changed: record silently.
    if (!prev || !prev.fingerprint || prev.kind !== r.kind) {
      (prev && prev.fingerprint ? rebaselined : baseline).push(s);
      next[s.url] = { ...fresh, first_seen: prev?.first_seen || today, history: [...(prev?.history || []), { date: today, fingerprint: r.fingerprint }].slice(-HISTORY_MAX) };
      return;
    }
    delete next[s.url].failures;
    delete next[s.url].failing_since;
    if (prev.fingerprint !== r.fingerprint) {
      const change = { source: s, kind: r.kind };
      if (r.kind === 'links' || r.kind === 'rows') {
        const key = r.kind === 'links' ? 'links' : 'lines';
        const before = new Set(prev[key] || []);
        const after = new Set(r[key] || []);
        change.added = [...after].filter((l) => !before.has(l));
        change.removed = [...before].filter((l) => !after.has(l));
      }
      changes.push(change);
      next[s.url].pending = { date: today, fingerprint: r.fingerprint, links: r.links, lines: r.lines };
    } else {
      delete next[s.url].pending;
    }
  });
  return { changes, errors, stillFailing, baseline, rebaselined, unreadable, next };
}

// Accept pending fingerprints (after the dataset has been reviewed).
function accept(state, today) {
  for (const entry of Object.values(state)) {
    if (!entry.pending) continue;
    entry.fingerprint = entry.pending.fingerprint;
    if (entry.pending.links) entry.links = entry.pending.links;
    if (entry.pending.lines) entry.lines = entry.pending.lines;
    entry.history = [...(entry.history || []), { date: today, fingerprint: entry.fingerprint }].slice(-HISTORY_MAX);
    delete entry.pending;
  }
  return state;
}

const SHOW = 8;
const clip = (l) => (l.length > 160 ? `${l.slice(0, 157)}...` : l);

function report({ changes, errors, stillFailing = [], baseline, rebaselined = [], unreadable = [] }, today) {
  const lines = [`# Official source check, ${today}`, ''];
  if (!changes.length && !errors.length) lines.push('No official source changed.', '');
  if (changes.length) {
    lines.push(`## ${changes.length} source(s) changed`, '', 'Review the dataset rows taken from each source, update `raw/`, rebuild, then run `node scripts/watch-sources.js --update`.', '');
    for (const c of changes) {
      lines.push(`- **${c.source.vendor}**: ${c.source.url}${c.source.rows ? ` (${c.source.rows} rows in the dataset)` : ''}`);
      if (c.kind === 'links') {
        for (const l of c.added || []) lines.push(`  - new document linked: ${l}`);
        for (const l of c.removed || []) lines.push(`  - document no longer linked: ${l}`);
      } else if (c.kind === 'rows') {
        for (const l of (c.added || []).slice(0, SHOW)) lines.push(`  - now reads: \`${clip(l)}\``);
        for (const l of (c.removed || []).slice(0, SHOW)) lines.push(`  - no longer reads: \`${clip(l)}\``);
        const more = Math.max(0, (c.added || []).length - SHOW) + Math.max(0, (c.removed || []).length - SHOW);
        if (more) lines.push(`  - and ${more} more line(s)`);
      }
    }
    lines.push('');
  }
  if (errors.length) {
    lines.push(`## ${errors.length} source(s) could not be checked`, '', 'A source that keeps failing may have moved: find its new official location.', '');
    for (const e of errors) lines.push(`- **${e.source.vendor}**: ${e.source.url} (${e.error})`);
    lines.push('');
  }
  if (stillFailing.length) {
    lines.push('<details><summary>' + `${stillFailing.length} source(s) still failing (already reported)` + '</summary>', '');
    for (const e of stillFailing) lines.push(`- **${e.source.vendor}**: ${e.source.url} (${e.error}, since ${e.since})`);
    lines.push('', '</details>', '');
  }
  if (unreadable.length) {
    lines.push('<details><summary>' + `${unreadable.length} page(s) need a browser to check` + '</summary>', '', 'Their rows are filled in by a script, so the page text has none of the dataset models. Check them by hand from time to time.', '');
    for (const s of unreadable) lines.push(`- **${s.vendor}**: ${s.url}`);
    lines.push('', '</details>', '');
  }
  if (baseline.length) lines.push(`${baseline.length} source(s) recorded for the first time.`);
  if (rebaselined.length) lines.push(`${rebaselined.length} source(s) re-recorded after a change in how pages are compared.`);
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
    // errors counts new failures only: a source already reported does not
    // reopen the issue every week.
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${outcome.changes.length}\nerrors=${outcome.errors.length}\nbaseline=${outcome.baseline.length}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}

module.exports = { visibleText, textLines, relevantLines, extractLinks, sourcesFromDataset, fingerprint, compare, accept, report };
