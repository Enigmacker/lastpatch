'use strict';

// Actively exploited vulnerabilities (CISA KEV catalogue) per device model.
// An entry applies to a model when the vendors agree and the model name
// appears as whole words in the entry's product name, title or description
// ("Archer C5" does not match "Archer C50"). CISA descriptions often name
// the affected hardware versions: they are shown to the user, who checks
// the label under the device.

const fs = require('node:fs');
const path = require('node:path');
const { canonicalVendor, hasTokenRun, stripSeries } = require('./match');

const KEV_FILE = path.join(__dirname, '..', 'data', 'kev.json');

// Words that describe a product family rather than a model.
const GENERIC = /\b(multiple|devices?|routers?|firmware|access point|storage|device|ip cameras?|camera|nas|network[- ]attached storage|\(nas\))\b/gi;

function loadKev(file = KEV_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function entryText(e) {
  return `${e.product} ${e.vulnerabilityName || ''} ${e.shortDescription || ''}`;
}

function modelNames(model) {
  const names = new Set([model, stripSeries(model), model.replace(/\s*\([^)]*\)/g, '').trim()]);
  return [...names].filter((n) => n && /\d/.test(n));
}

// Hardware versions CISA lists right after the model name, e.g.
// "TL-WR841N V8/V10" -> ['V8', 'V10']. Empty when none are given.
function listedVersions(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(text).match(new RegExp(`${escaped}\\s+((?:v\\d+(?:\\.\\d+)?)(?:\\s*(?:/|,|and)\\s*v?\\d+(?:\\.\\d+)?)*)`, 'i'));
  if (!m) return [];
  return m[1].split(/\s*(?:\/|,|and)\s*/i).map((v) => `V${v.replace(/^v/i, '')}`);
}

function sameVersion(a, b) {
  const n = (v) => v.toUpperCase().replace(/(\d)\.0\b/g, '$1');
  return n(a) === n(b);
}

function appliesTo(entry, row) {
  const v = canonicalVendor(entry.vendorProject);
  if (!v || v !== canonicalVendor(row.vendor)) return false;
  const text = entryText(entry);
  const name = modelNames(row.model).find((n) => hasTokenRun(text, n));
  if (!name) return false;
  // When CISA names the affected hardware versions and ours is not among
  // them, the entry concerns another version of the model.
  const affected = listedVersions(text, name);
  if (affected.length && row.hw_version) {
    const ours = row.hw_version.split(/\s*,\s*/);
    if (!ours.some((o) => affected.some((a) => sameVersion(o, a)))) return false;
  }
  return true;
}

// Returns a function row -> [entries], cached per model.
function indexer(kev = loadKev()) {
  const entries = (kev && kev.vulnerabilities) || [];
  const cache = new Map();
  return (row) => {
    const key = `${row.vendor}|${row.model}|${row.hw_version || ""}`;
    if (!cache.has(key)) cache.set(key, entries.filter((e) => appliesTo(e, row)));
    return cache.get(key);
  };
}

// For a model that is not in the dataset: entries whose product names a
// specific model that appears in the query ("D-Link DIR-859" -> "DIR-859 Router").
function forQuery(query, kev = loadKev()) {
  const v = canonicalVendor(query);
  if (!v) return [];
  return ((kev && kev.vulnerabilities) || []).filter((e) => {
    if (canonicalVendor(e.vendorProject) !== v) return false;
    const core = e.product.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
    return /\d/.test(core) && core.split(/\s+and\s+/i).some((c) => /\d/.test(c) && hasTokenRun(query, c));
  });
}

module.exports = { loadKev, appliesTo, indexer, forQuery, listedVersions };
