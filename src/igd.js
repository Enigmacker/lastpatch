'use strict';

// Internet exposure: list the port forwards that devices opened on the
// router through UPnP (Internet Gateway Device protocol). Read-only: only
// the "GetGenericPortMappingEntry" query is sent, to the router's own LAN
// address. Nothing is added, changed or removed.

const http = require('node:http');
const { isPrivateHost } = require('./lan');

const WAN_SERVICE = /urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:\d/i;
const MAX_ENTRIES = 128;

function soapBody(serviceType, index) {
  return '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:GetGenericPortMappingEntry xmlns:u="${serviceType}">` +
    `<NewPortMappingIndex>${index}</NewPortMappingIndex>` +
    '</u:GetGenericPortMappingEntry></s:Body></s:Envelope>';
}

function post(controlURL, serviceType, body, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(controlURL); } catch { return resolve(null); }
    if (u.protocol !== 'http:' || !isPrivateHost(u.hostname)) return resolve(null);
    const req = http.request(u, {
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${serviceType}#GetGenericPortMappingEntry"`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size < 64 * 1024) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body);
  });
}

function field(xml, name) {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

// Parse one GetGenericPortMappingEntry response; null when there is no entry.
function parseEntry(res) {
  if (!res || res.status !== 200) return null;
  const internalClient = field(res.body, 'NewInternalClient');
  const externalPort = field(res.body, 'NewExternalPort');
  if (!internalClient || !externalPort) return null;
  return {
    externalPort: Number(externalPort),
    protocol: (field(res.body, 'NewProtocol') || '').toUpperCase(),
    internalClient,
    internalPort: Number(field(res.body, 'NewInternalPort')) || null,
    enabled: field(res.body, 'NewEnabled') !== '0',
    description: field(res.body, 'NewPortMappingDescription') || null,
    remoteHost: field(res.body, 'NewRemoteHost') || null,
    leaseSeconds: Number(field(res.body, 'NewLeaseDuration')) || 0,
  };
}

// Port mappings of every Internet gateway found by SSDP.
async function portMappings(upnpDevices, { requester = post } = {}) {
  const services = [];
  const seen = new Set();
  for (const d of upnpDevices) {
    for (const s of d.services || []) {
      if (WAN_SERVICE.test(s.serviceType) && !seen.has(s.controlURL)) {
        seen.add(s.controlURL);
        services.push({ ...s, router: d.ip });
      }
    }
  }
  const mappings = [];
  for (const s of services) {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      // The router answers an error (SpecifiedArrayIndexInvalid) after the last entry.
      const entry = parseEntry(await requester(s.controlURL, s.serviceType, soapBody(s.serviceType, i)));
      if (!entry) break;
      mappings.push({ ...entry, router: s.router });
    }
  }
  return mappings;
}

module.exports = { portMappings, parseEntry, soapBody, WAN_SERVICE };
