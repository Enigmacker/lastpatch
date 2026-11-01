'use strict';

// Manufacturer lookup from the first three bytes of a MAC address, using
// the public IEEE MA-L registry. The registry is downloaded once by
// `lastpatch update-oui` and cached locally; it is not bundled.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const IEEE_URL = 'https://standards-oui.ieee.org/oui/oui.csv';

function cacheFile() {
  if (process.env.LASTPATCH_OUI) return process.env.LASTPATCH_OUI;
  const base = process.env.XDG_CACHE_HOME ||
    (process.platform === 'win32' ? process.env.LOCALAPPDATA : null) ||
    path.join(os.homedir(), '.cache');
  return path.join(base, 'lastpatch', 'oui.csv');
}

// Minimal CSV line parser (quoted fields with commas).
function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// oui.csv columns: Registry,Assignment,Organization Name,Organization Address
function parseOui(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [, assignment, org] = splitCsv(line);
    if (/^[0-9A-F]{6}$/i.test(assignment || '') && org) map.set(assignment.toUpperCase(), org.trim());
  }
  return map;
}

let cached;
function loadOui(file = cacheFile()) {
  if (cached !== undefined) return cached;
  try { cached = parseOui(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  return cached;
}

function vendorOf(mac, table = loadOui()) {
  if (!table || !mac) return null;
  return table.get(mac.replace(/[:-]/g, '').slice(0, 6).toUpperCase()) || null;
}

function download(url, dest, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'lastpatch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`IEEE registry: HTTP ${res.statusCode}`)); }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function updateOui() {
  const dest = cacheFile();
  await download(IEEE_URL, dest);
  cached = undefined;
  const table = loadOui(dest);
  return { file: dest, entries: table ? table.size : 0 };
}

module.exports = { parseOui, vendorOf, loadOui, updateOui, cacheFile };
