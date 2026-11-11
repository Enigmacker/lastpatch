#!/usr/bin/env node
'use strict';

// Fill data/firmware.json with the latest firmware each manufacturer
// publishes, from official machine-readable sources only.
//
// AVM: the download server lists one folder per FRITZ!Box, with the current
// image file and its release notes:
//   https://download.avm.de/fritzbox/fritzbox-7590/deutschland/fritz.os/
//     FRITZ.Box_7590-08.51.image
//     info_de.txt   "Version:        FRITZ!OS 8.51" / "Release-Datum:  09.11.2026"
//     info_en.txt   "Version:        FRITZ!OS 8.51" / "Release date:   09/11/2026"
// The version is taken from the image file name (what AVM actually serves);
// the release date only from a release note that describes that same
// version. When the notes lag behind the image, the date is left empty.
//
//   node scripts/update-firmware.js                 update data/firmware.json
//   node scripts/update-firmware.js --dry-run       print the rows, write nothing
//   node scripts/update-firmware.js --only "FRITZ!Box 7590"
//
// Polite by design: one request at a time, a pause between requests, no
// retries in a loop. Meant for the weekly GitHub Action.

const fs = require('node:fs');
const path = require('node:path');
const { parseVersion, compareVersions } = require('../src/firmware');

const OUT = path.join(__dirname, '..', 'data', 'firmware.json');
const DEVICES = path.join(__dirname, '..', 'data', 'devices.json');
const AVM_BASE = 'https://download.avm.de/fritzbox/';
// Download folders by market, first one found wins.
const AVM_REGIONS = [
  { folder: 'deutschland', region: 'DE' },
  { folder: 'other', region: null },
];
const INFO_FILES = ['info_de.txt', 'info_en.txt', 'info.txt'];

// Models whose hardware versions have separate download folders.
const AVM_FOLDERS = {
  'FRITZ!Box 6820': [
    { folder: 'fritzbox-6820-lte', hw: null },
    { folder: 'fritzbox-6820-lte-v2', hw: 'V2' },
    { folder: 'fritzbox-6820-lte-v3', hw: 'V3' },
    { folder: 'fritzbox-6820-lte-v4', hw: 'V4' },
  ],
  'FRITZ!Box 6850 5G': [
    { folder: 'fritzbox-6850-5g', hw: null },
    { folder: 'fritzbox-6850-5g-v2', hw: 'V2' },
  ],
  'FRITZ!Box 6860 5G': [
    { folder: 'fritzbox-6860-5g', hw: null },
    { folder: 'fritzbox-6860-5g-v2', hw: 'V2' },
  ],
  'FRITZ!Box 7520': [
    { folder: 'fritzbox-7520', hw: null },
    { folder: 'fritzbox-7520-B', hw: 'B' },
  ],
  'FRITZ!Box 7630': [
    { folder: 'fritzbox-7630', hw: null },
    { folder: 'fritzbox-7630-b', hw: 'B' },
  ],
};

// "FRITZ!Box 6660 Cable" -> "fritzbox-6660-cable"; "DSL/Fiber 7-90" -> "fritzbox-dsl-fiber-7-90".
function avmFolder(model) {
  const m = String(model).match(/^FRITZ!Box\s+(.+)$/i);
  if (!m) return null;
  return `fritzbox-${m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function avmTargets(devices) {
  const models = [...new Set(devices.filter((d) => d.vendor === 'AVM').map((d) => d.model))]
    .filter((m) => /^FRITZ!Box\s/i.test(m))
    .sort();
  return models.flatMap((model) =>
    (AVM_FOLDERS[model] || [{ folder: avmFolder(model), hw: null }]).map((f) => ({ model, ...f })));
}

// FRITZ!OS version as AVM writes it: "8.51", "7.57", "8.03".
// Accepts "FRITZ!OS 8.51", "08.51", "154.07.57".
function avmVersion(raw) {
  const p = parseVersion(raw, 'AVM');
  if (!p || p.parts.length < 2) return null;
  const [major, minor, patch] = p.parts;
  return [String(major), String(minor).padStart(2, '0'), patch != null ? String(patch).padStart(2, '0') : null]
    .filter((x) => x != null).join('.');
}

// Dates in the notes: "09.11.2026", "09/11/2026" (day first) or "2026-11-09".
function parseDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

// File names in an autoindex directory listing (nginx or Apache).
function parseListing(html) {
  const names = [];
  for (const m of String(html || '').matchAll(/<a\s+href="([^"?#/][^"?#]*)"/gi)) {
    const name = decodeURIComponent(m[1]);
    if (!name.includes('/') && !names.includes(name)) names.push(name);
  }
  return names;
}

// "FRITZ.Box_7590-08.51.image" -> "8.51"
function imageVersion(name) {
  const m = String(name).match(/-(\d{2,3}\.\d{2}(?:\.\d{2})?)\.image$/i);
  return m ? avmVersion(m[1]) : null;
}

// Header of an AVM release note: the first Product/Version/Release date lines
// (older versions are described further down and are ignored).
function parseInfo(text) {
  const lines = String(text || '').split(/\r?\n/);
  let product = null;
  let version = null;
  let date = null;
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z -]*?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!product && /^(produkt|product)$/.test(key)) product = m[2];
    else if (!version && key === 'version') version = avmVersion(m[2]);
    else if (!date && /^(release-datum|release date|release-date|datum|date)$/.test(key)) date = parseDate(m[2]);
    if (product && version && date) break;
  }
  return version ? { product, version, release_date: date } : null;
}

// Choose the published version and its date.
function pickLatest(images, infos) {
  const warnings = [];
  const versions = images.map(imageVersion).filter(Boolean);
  let latest = versions.sort((a, b) => compareVersions(b, a, 'AVM'))[0] || null;
  if (!latest) {
    const fromInfo = infos.map((i) => i.version).sort((a, b) => compareVersions(b, a, 'AVM'))[0];
    if (!fromInfo) return { latest: null, release_date: null, warnings: ['no image file and no release note'] };
    latest = fromInfo;
    warnings.push('no image file listed; version taken from the release note');
  }
  const same = infos.find((i) => i.version === latest && i.release_date);
  if (!same) {
    const seen = infos.map((i) => i.version).join(', ') || 'none';
    warnings.push(`release notes describe ${seen}, not ${latest}: release date left empty`);
  }
  return { latest, release_date: same ? same.release_date : null, warnings };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFetcher(delayMs) {
  let first = true;
  return async function fetchText(url) {
    if (!first) await sleep(delayMs);
    first = false;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'lastpatch firmware index (weekly, one request at a time)' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new TextDecoder('utf-8').decode(await res.arrayBuffer());
  };
}

async function avmRow(target, fetchText, today) {
  for (const { folder, region } of AVM_REGIONS) {
    const dir = `${AVM_BASE}${target.folder}/${folder}/fritz.os/`;
    const listing = await fetchText(dir);
    if (!listing) continue;
    const files = parseListing(listing);
    const images = files.filter((f) => /\.image$/i.test(f));
    const served = images.map(imageVersion).filter(Boolean).sort((a, b) => compareVersions(b, a, 'AVM'))[0];
    const infos = [];
    // Release notes are large: stop at the first one describing the image.
    for (const name of INFO_FILES.filter((n) => files.includes(n))) {
      const info = parseInfo(await fetchText(dir + name));
      if (info) infos.push(info);
      if (info && served && info.version === served && info.release_date) break;
    }
    const pick = pickLatest(images, infos);
    if (!pick.latest) return { row: null, warnings: [`${dir}: ${pick.warnings.join('; ')}`] };
    return {
      row: {
        vendor: 'AVM',
        model: target.model,
        hw_version: target.hw,
        region,
        latest_version: pick.latest,
        release_date: pick.release_date,
        source_url: dir,
        retrieved: today,
      },
      warnings: pick.warnings.map((w) => `${target.model}${target.hw ? ` ${target.hw}` : ''}: ${w}`),
    };
  }
  return { row: null, warnings: [`${target.model}: no download folder ${target.folder}`] };
}

const key = (r) => `${r.vendor}|${r.model}|${r.hw_version || ''}`;

// New rows replace old rows of the same model and hardware version; rows that
// could not be refreshed this time are kept.
function merge(existing, fresh) {
  const map = new Map(existing.map((r) => [key(r), r]));
  for (const r of fresh) map.set(key(r), r);
  return [...map.values()].sort((a, b) =>
    a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model, 'en', { numeric: true }) ||
    String(a.hw_version || '').localeCompare(String(b.hw_version || '')));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const delay = args.includes('--delay') ? Number(args[args.indexOf('--delay') + 1]) : 1500;
  const today = new Date().toISOString().slice(0, 10);

  const devices = JSON.parse(fs.readFileSync(DEVICES, 'utf8')).devices;
  let targets = avmTargets(devices);
  if (only) targets = targets.filter((t) => t.model.toLowerCase() === only.toLowerCase());

  const fetchText = makeFetcher(delay);
  const fresh = [];
  const warnings = [];
  let errors = 0;
  for (const t of targets) {
    try {
      const { row, warnings: w } = await avmRow(t, fetchText, today);
      if (row) fresh.push(row);
      warnings.push(...w);
    } catch (err) {
      errors++;
      warnings.push(`${t.model}: ${err.message}`);
    }
  }
  for (const w of warnings) console.error(`note: ${w}`);
  console.error(`${fresh.length} row(s) read, ${errors} error(s), ${targets.length} folder(s) tried`);

  if (dry) {
    console.log(JSON.stringify(fresh, null, 2));
    return;
  }
  const current = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { version: '0.1.0', firmware: [] };
  if (!fresh.length) {
    if (targets.length) process.exitCode = 1;
    return;
  }
  // Rows are compared without their retrieval date, so an unchanged week
  // leaves the file untouched.
  const firmware = merge(current.firmware || [], fresh);
  const strip = (list) => JSON.stringify(list.map(({ retrieved, ...r }) => r));
  if (strip(firmware) === strip(current.firmware || [])) {
    console.error('no change');
    return;
  }
  const out = { version: current.version || '0.1.0', generated: today, license: 'ODbL-1.0', firmware };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
}

if (require.main === module) main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

module.exports = { avmFolder, avmTargets, avmVersion, parseDate, parseListing, imageVersion, parseInfo, pickLatest, avmRow, merge };
