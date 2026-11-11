'use strict';

// Read-only look at a device's web admin page. The page title and the HTTP
// authentication realm (e.g. realm "TP-LINK Archer C7") often name the
// model. GET only, LAN addresses only, small limits; nothing is submitted
// and no password is tried.

const http = require('node:http');
const https = require('node:https');
const { isPrivateHost } = require('./lan');

function get(url, timeoutMs, maxBytes) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    // Admin pages use self-signed certificates; we only read a title and
    // send no credentials, so certificate checks are not needed here.
    const req = mod.get(u, { timeout: timeoutMs, rejectUnauthorized: false, headers: { 'User-Agent': 'lastpatch' } }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return; }
        chunks.push(c);
      });
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.on('end', finish);
      res.on('close', finish);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t || null;
}

function extractRealm(headers) {
  const m = String((headers && headers['www-authenticate']) || '').match(/realm="([^"]{1,200})"/i);
  return m ? m[1].trim() : null;
}

// Follows at most two redirects, and only to the same LAN host.
async function fetchPage(startUrl, ip, timeoutMs, maxBytes) {
  let url = startUrl;
  for (let i = 0; i < 3; i++) {
    const res = await get(url, timeoutMs, maxBytes);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      let next;
      try { next = new URL(res.headers.location, url); } catch { return res; }
      if (next.hostname !== ip) return res;
      url = next.href;
      continue;
    }
    return res;
  }
  return null;
}

// Tries HTTP, then HTTPS. Returns { title, realm, server } or null.
async function probeHttp(ip, { timeoutMs = 2000, maxBytes = 128 * 1024 } = {}) {
  if (!isPrivateHost(ip)) return null;
  for (const scheme of ['http', 'https']) {
    const res = await fetchPage(`${scheme}://${ip}/`, ip, timeoutMs, maxBytes);
    if (!res) continue;
    const hints = {
      title: extractTitle(res.body),
      realm: extractRealm(res.headers),
      server: res.headers.server ? String(res.headers.server).slice(0, 200) : null,
    };
    if (hints.title || hints.realm) return hints;
  }
  return null;
}

// One GET of a small file on a LAN device (plain HTTP, any port), without
// following redirects. Returns { status, headers, body } or null.
async function fetchLan(url, { timeoutMs = 2000, maxBytes = 64 * 1024 } = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' || !isPrivateHost(u.hostname)) return null;
  return get(u.href, timeoutMs, maxBytes);
}

module.exports = { probeHttp, fetchLan, extractTitle, extractRealm };
