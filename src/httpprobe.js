'use strict';

// Read the title of a device's web admin page: on many routers, cameras and
// NAS it names the model. Read-only GET, LAN addresses only, small limits.

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
  const t = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t || null;
}

// Follows at most two redirects, and only to the same LAN host.
async function probeHttp(ip, { timeoutMs = 2000, maxBytes = 128 * 1024 } = {}) {
  if (!isPrivateHost(ip)) return null;
  let url = `http://${ip}/`;
  for (let i = 0; i < 3; i++) {
    const res = await get(url, timeoutMs, maxBytes);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, url);
      if (next.hostname !== ip) return { title: null, server: res.headers.server || null };
      url = next.href;
      continue;
    }
    return { title: extractTitle(res.body), server: res.headers.server || null };
  }
  return null;
}

module.exports = { probeHttp, extractTitle };
