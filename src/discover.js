'use strict';

// Full local network discovery, read-only and without admin rights.
// Combines five sources of evidence per IP address:
//   neighbour table (after a light sweep) -> every device and its MAC
//   MAC vendor (IEEE registry)             -> manufacturer
//   UPnP / SSDP                            -> manufacturer and model
//   mDNS / DNS-SD                          -> device name and model (TXT)
//   web admin page title and login realm   -> model, on many routers/NAS
//   firmware info files (FRITZ!Box, NETGEAR) and UPnP -> installed firmware
// plus the router's UPnP port forwards, to show which devices are reachable
// from the Internet.

const neighbors = require('./neighbors');
const ssdp = require('./ssdp');
const mdns = require('./mdns');
const igd = require('./igd');
const { probeHttp } = require('./httpprobe');
const { readFirmware, probeNote } = require('./fwprobe');
const { vendorOf } = require('./oui');
const { isPrivateHost } = require('./lan');
const { findDevice, canonicalVendor, sameMaker } = require('./match');

async function collect({ timeoutMs = 3000, sweep = true } = {}) {
  const [web, upnp, bonjour] = await Promise.all([
    sweep ? neighbors.sweep() : Promise.resolve(new Set()),
    ssdp.discover({ timeoutMs }),
    mdns.browse({ timeoutMs }),
  ]);
  const table = await neighbors.readNeighborTable();

  const hosts = new Map();
  const host = (ip) => {
    if (!hosts.has(ip)) hosts.set(ip, { ip, mac: null, macVendor: null, randomMac: false, note: null, upnp: [], mdns: null, http: null, firmware: null, exposed: [] });
    return hosts.get(ip);
  };
  for (const [ip, mac] of table) {
    if (!isPrivateHost(ip)) continue;
    const h = host(ip);
    h.mac = mac;
    h.randomMac = neighbors.isRandomMac(mac);
    h.macVendor = h.randomMac ? null : vendorOf(mac);
  }
  for (const d of upnp) host(d.ip).upnp.push(d);
  for (const d of bonjour) if (isPrivateHost(d.ip)) host(d.ip).mdns = d;
  for (const ip of web) host(ip);
  for (const m of await igd.portMappings(upnp)) {
    if (m.enabled && isPrivateHost(m.internalClient)) host(m.internalClient).exposed.push(m);
  }

  await Promise.all([...hosts.values()].map(async (h) => {
    if (web.has(h.ip) || h.upnp.length) h.http = await probeHttp(h.ip);
    if (h.http || h.upnp.length) h.firmware = await readFirmware(h);
    if (h.http && !h.firmware) h.note = await probeNote(h);
  }));
  return [...hosts.values()].sort((a, b) =>
    a.ip.split('.').map(Number).reduce((x, y) => x * 256 + y) - b.ip.split('.').map(Number).reduce((x, y) => x * 256 + y));
}

// Build the candidate descriptions of a host, most reliable first.
function candidates(h) {
  const out = [];
  const vendorHint = h.macVendor || '';
  for (const u of h.upnp) {
    const q = [u.manufacturer, u.modelName, u.modelNumber].filter(Boolean).join(' ');
    if (q) out.push({ via: 'UPnP', query: q });
  }
  if (h.firmware && h.firmware.model) {
    out.push({ via: `device info file (${h.firmware.source})`, query: `${vendorHint} ${h.firmware.model}`.trim() });
  }
  if (h.mdns && h.mdns.model) out.push({ via: 'mDNS', query: `${vendorHint} ${h.mdns.model}`.trim() });
  if (h.http && h.http.realm) out.push({ via: 'admin login prompt', query: `${vendorHint} ${h.http.realm}`.trim() });
  if (h.http && h.http.title) out.push({ via: 'web page title', query: `${vendorHint} ${h.http.title}`.trim() });
  if (h.mdns) for (const n of h.mdns.names) out.push({ via: 'mDNS name', query: `${vendorHint} ${n}`.trim() });
  return out;
}

// Identify each host against the dataset.
function identify(hosts, devices) {
  return hosts.map((h) => {
    const tried = candidates(h);
    for (const c of tried) {
      const res = findDevice(devices, c.query);
      // A match must agree with the MAC vendor when we know it.
      const macV = canonicalVendor(h.macVendor);
      const ok = res.matches.length && (!macV || sameMaker(canonicalVendor(res.matches[0].row.vendor), macV));
      if (ok) return { host: h, via: c.via, query: c.query, matches: res.matches, hwVersion: res.hwVersion };
    }
    return { host: h, via: null, query: tried[0] ? tried[0].query : null, matches: [], hwVersion: null };
  });
}

function label(h) {
  const parts = [];
  if (h.upnp[0] && h.upnp[0].friendlyName) parts.push(h.upnp[0].friendlyName);
  else if (h.mdns && h.mdns.names[0]) parts.push(h.mdns.names[0]);
  else if (h.http && h.http.title) parts.push(h.http.title);
  return parts.join(' ');
}

module.exports = { collect, identify, candidates, label };
