'use strict';

// Reads the firmware version installed on a LAN device, read-only and
// without credentials, from files the device publishes to anyone on the
// local network:
//   AVM FRITZ!Box  http://<ip>/jason_boxinfo.xml, else the TR-064 description
//                  http://<ip>:49000/tr64desc.xml
//   NETGEAR        http://<ip>/currentsetting.htm
//   any device     <firmwareVersion> / <softwareVersion> in its UPnP description
// Private addresses only, GET only, short timeouts. The serial number and
// other identifiers in these files are not kept.

const { fetchLan } = require('./httpprobe');
const { isPrivateHost } = require('./lan');
const { canonicalVendor } = require('./match');

function tag(xml, name) {
  // Namespaced (<j:Version>) or plain (<Version>) element; self-closing is empty.
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1].trim() : null;
}

// AVM jason_boxinfo.xml
function parseJasonBoxinfo(xml) {
  const text = String(xml || '');
  if (!/BoxInfo/i.test(text)) return null;
  const version = tag(text, 'Version');
  if (!version) return null;
  const lab = tag(text, 'Lab');
  return {
    model: tag(text, 'Name'),
    version,
    lab: !!lab,
    oem: tag(text, 'OEM'),
  };
}

// AVM TR-064 description: <systemVersion><HW>..</HW><Major>..<Display>154.07.57</Display>
function parseTr64Desc(xml) {
  const text = String(xml || '');
  const m = text.match(/<systemVersion>([\s\S]*?)<\/systemVersion>/i);
  if (!m) return null;
  const sv = m[1];
  let version = tag(sv, 'Display');
  if (!version) {
    const major = tag(sv, 'Major');
    const minor = tag(sv, 'Minor');
    const patch = tag(sv, 'Patch');
    if (major && minor) version = [major, minor.padStart(2, '0'), patch ? patch.padStart(2, '0') : null].filter(Boolean).join('.');
  }
  if (!version) return null;
  return { model: tag(sv, 'HW') || tag(text, 'modelName'), version, lab: false, oem: null };
}

// NETGEAR currentsetting.htm: "Firmware=V1.0.4.126_10.1.12\nRegionTag=...\nModel=RAX120".
// Some models separate the pairs with \r only, or with nothing at all.
const NETGEAR_KEYS = ['Firmware', 'RegionTag', 'Region', 'Model', 'InternetConnectionStatus',
  'ParentalControlSupported', 'SOAPVersion', 'ReadyShareSupportedLevel', 'XCloudSupported', 'LoginMethod'];
function parseCurrentSetting(text) {
  const body = String(text || '');
  const keys = NETGEAR_KEYS.join('|');
  const out = {};
  const re = new RegExp(`(${keys})=([\\s\\S]*?)(?=(?:${keys})=|[\\r\\n]|$)`, 'g');
  for (const m of body.matchAll(re)) {
    if (!(m[1] in out)) out[m[1]] = m[2].trim();
  }
  if (!out.Firmware) return null;
  return { model: out.Model || null, version: out.Firmware, lab: false, oem: null };
}

// <firmwareVersion> or <softwareVersion> of a UPnP description (never
// modelNumber, which is a model code on most devices).
function fromUpnp(upnp) {
  for (const u of upnp || []) {
    if (u.firmwareVersion) return { version: u.firmwareVersion, source: 'UPnP firmwareVersion' };
    if (u.softwareVersion) return { version: u.softwareVersion, source: 'UPnP softwareVersion' };
  }
  return null;
}

function vendorsOf(h) {
  const names = [h.macVendor, ...(h.upnp || []).map((u) => `${u.manufacturer || ''} ${u.modelName || ''}`),
    h.http && h.http.title, h.http && h.http.realm];
  return new Set(names.filter(Boolean).map(canonicalVendor).filter(Boolean));
}

// Returns { version, source, model, lab, oem } or null.
// `fetch` is injectable for tests: (url) => Promise<{status, body}|null>.
async function readFirmware(h, { fetch = fetchLan, timeoutMs = 2000 } = {}) {
  if (!h || !isPrivateHost(h.ip)) return null;
  const vendors = vendorsOf(h);
  const get = async (url) => {
    const res = await fetch(url, { timeoutMs });
    return res && res.status === 200 ? res.body : null;
  };

  if (vendors.has('avm')) {
    const box = parseJasonBoxinfo(await get(`http://${h.ip}/jason_boxinfo.xml`));
    if (box) return { ...box, source: 'jason_boxinfo.xml' };
    const tr = parseTr64Desc(await get(`http://${h.ip}:49000/tr64desc.xml`));
    if (tr) return { ...tr, source: 'TR-064 description' };
  }
  if (vendors.has('netgear')) {
    const ng = parseCurrentSetting(await get(`http://${h.ip}/currentsetting.htm`));
    if (ng) return { ...ng, source: 'currentsetting.htm' };
  }
  const u = fromUpnp(h.upnp);
  if (u) return { ...u, model: null, lab: false, oem: null };
  return null;
}

module.exports = { readFirmware, parseJasonBoxinfo, parseTr64Desc, parseCurrentSetting, fromUpnp };
