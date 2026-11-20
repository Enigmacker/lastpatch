'use strict';

// History of published end dates (data/history.json).
//
// For every row key (vendor, model, hardware version, region) the history
// lists each end date the dataset has published, in order, with the dataset
// dates on which it was first and last seen. Entries are only ever appended
// or extended: a row that leaves the dataset keeps its history.

const FORMAT = 1;

function rowKey(r) {
  return [r.vendor, r.model, r.hw_version ?? null, r.region || 'global'].join('|').toLowerCase();
}

function emptyHistory() {
  return { format: FORMAT, generated: null, license: 'ODbL-1.0', rows: [] };
}

// True when `end` is earlier than an end date published before it.
function isShortened(dates, end) {
  if (!end) return false;
  return dates.some((d) => d.support_end && d.support_end > end);
}

/**
 * Sets the `shortened` flags of one key from its dates. An entry marked
 * `correction` (a change in how the dataset reads the source, not a new date
 * from the manufacturer) is never flagged, and the dates before it are no
 * longer compared with the ones after it.
 */
function flagShortened(h) {
  let before = [];
  h.shortened = false;
  for (const d of h.dates) {
    if (d.correction) {
      delete d.shortened;
      before = [d];
      continue;
    }
    if (isShortened(before, d.support_end)) {
      d.shortened = true;
      h.shortened = true;
    } else {
      delete d.shortened;
    }
    before.push(d);
  }
  return h;
}

/**
 * Records the rows of one dataset build, seen on `seenOn` (the dataset's
 * `generated` date). Returns the same history object, updated.
 * - same end date as the latest entry: extends its `last_seen`;
 * - a different end date (or a new key): appends an entry;
 * - an appended date earlier than any date published before it is flagged
 *   `shortened`, and so is the key (see flagShortened).
 * Fields added by hand to an entry (`correction`, `note`) are kept.
 */
function recordBuild(history, devices, seenOn) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seenOn || '')) throw new Error(`bad dataset date ${seenOn}`);
  const byKey = new Map(history.rows.map((h) => [rowKey(h), h]));
  const done = new Set();
  for (const r of devices) {
    const key = rowKey(r);
    if (done.has(key)) continue; // a build has one row per key; ignore stray duplicates
    done.add(key);
    let h = byKey.get(key);
    if (!h) {
      h = { vendor: r.vendor, model: r.model, hw_version: r.hw_version ?? null, region: r.region || 'global', shortened: false, dates: [] };
      byKey.set(key, h);
      history.rows.push(h);
    } else {
      // Keep the spelling of the latest build.
      h.vendor = r.vendor;
      h.model = r.model;
      h.hw_version = r.hw_version ?? null;
      h.region = r.region || 'global';
    }
    const last = h.dates[h.dates.length - 1];
    if (last && last.support_end === r.support_end) {
      if (seenOn > last.last_seen) last.last_seen = seenOn;
      continue;
    }
    if (last && seenOn < last.last_seen) {
      throw new Error(`${key}: build of ${seenOn} is older than the history (${last.last_seen})`);
    }
    h.dates.push({
      support_end: r.support_end,
      support_end_raw: r.support_end_raw,
      first_seen: seenOn,
      last_seen: seenOn,
      source_url: r.source_url,
    });
  }
  for (const h of history.rows) flagShortened(h);
  if (!history.generated || seenOn > history.generated) history.generated = seenOn;
  history.rows.sort((a, b) =>
    a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model, undefined, { numeric: true }) ||
    String(a.hw_version).localeCompare(String(b.hw_version)) || a.region.localeCompare(b.region));
  return history;
}

/** Keys whose end date changed at least once. */
function changed(history) {
  return history.rows.filter((h) => h.dates.length > 1);
}

module.exports = { FORMAT, rowKey, emptyHistory, recordBuild, isShortened, flagShortened, changed };
