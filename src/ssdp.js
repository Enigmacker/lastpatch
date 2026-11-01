'use strict';

// Local network discovery over SSDP/UPnP. Read-only: sends M-SEARCH
// multicast requests and fetches the device description XML each device
// advertises. Only private (LAN) addresses are contacted.

const dgram = require('node:dgram');
const http = require('node:http');
const { isPrivateHost } = require('./lan');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = ['ssdp:all', 'upnp:rootdevice'];

function ssdpSearch(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const locations = new Set();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (msg) => {
      const m = msg.toString().match(/^location:\s*(.+)$/im);
      if (m) locations.add(m[1].trim());
    });
    socket.on('error', () => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...locations]);
    });
    socket.bind(() => {
      for (const st of SEARCH_TARGETS) {
        const req = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
            `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
            'MAN: "ssdp:discover"\r\n' +
            'MX: 2\r\n' +
            `ST: ${st}\r\n\r\n`
        );
        socket.send(req, SSDP_PORT, SSDP_ADDR);
      }
      setTimeout(() => {
        socket.close();
        resolve([...locations]);
      }, timeoutMs);
    });
  });
}

function fetchText(url, timeoutMs = 3000, maxBytes = 256 * 1024) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol !== 'http:' || !isPrivateHost(u.hostname)) return resolve(null);
    const req = http.get(u, { timeout: timeoutMs }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseDescription(xml, location) {
  return {
    ip: new URL(location).hostname,
    manufacturer: tag(xml, 'manufacturer'),
    modelName: tag(xml, 'modelName'),
    modelNumber: tag(xml, 'modelNumber'),
    modelDescription: tag(xml, 'modelDescription'),
    friendlyName: tag(xml, 'friendlyName'),
    location,
  };
}

async function discover({ timeoutMs = 3000 } = {}) {
  const locations = await ssdpSearch(timeoutMs);
  const devices = new Map();
  await Promise.all(
    locations.map(async (loc) => {
      const xml = await fetchText(loc);
      if (!xml) return;
      const d = parseDescription(xml, loc);
      const key = `${d.ip}|${d.manufacturer}|${d.modelName}|${d.modelNumber}`;
      if (!devices.has(key)) devices.set(key, d);
    })
  );
  return [...devices.values()];
}

module.exports = { discover, parseDescription, isPrivateHost };
