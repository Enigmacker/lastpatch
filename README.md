# LastPatch

**Is your router, camera or NAS still getting security updates?**

Devices that no longer receive patches stay vulnerable forever, and nothing tells you when yours reaches that point. LastPatch is an open dataset of **official** end-of-support dates for home network devices, plus a small command-line tool that looks up a model or scans your local network.

Every row cites the manufacturer document it comes from. No date is guessed: when a vendor publishes no date, the device is reported as `unknown`.

## Quick start

```bash
npm install -g .            # from a clone of this repository (Node.js 20+)

lastpatch check "FRITZ!Box 7490"
lastpatch check "Tapo C200 V3"          # add the hardware version from the label when you know it
lastpatch scan                          # find UPnP devices on your network and check them
lastpatch list --expiring 180           # models whose support ends within 180 days
```

```
  AVM FRITZ!Box 7490
    status : NO LONGER SUPPORTED (guaranteed period is over; the vendor may still ship occasional fixes)
    ends   : 2025-10-01 or later
    basis  : minimum guaranteed by the vendor (support may continue)
    source : https://fritz.com/pages/status-produktunterstuetzung [EU]
```

Each result says how far the date can be trusted (`basis`): an official end date, a minimum guaranteed by the vendor, a vendor statement without a date, or no date published.

### Actively exploited vulnerabilities

Results also list the vulnerabilities of the model that attackers are known to exploit, from the [CISA Known Exploited Vulnerabilities catalogue](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) (extract in `data/kev.json`, refreshed weekly). A device that is both unsupported and actively exploited should be replaced first. When CISA names the affected hardware versions, other versions of the model are not flagged. Models that are not in the dataset yet are still checked against the catalogue.

```
  "D-Link DIR-859": not in the dataset yet.
    ACTIVELY EXPLOITED: 2 vulnerability(ies) in the CISA KEV catalogue
      CVE-2019-17621: D-Link DIR-859 router contains a command execution vulnerability ...
```

Options: `--json` for machine-readable output, `--warn <days>` to change the "ending soon" window (default 365), `--region <cc>` to prefer dates published for a given market. Exit code `2` means at least one device is past its end of support, so the tool can be used in scripts.

## What the scan does

`lastpatch scan` combines five read-only techniques, needs no admin rights and installs nothing:

| Step | What it finds |
|---|---|
| Light sweep of your local subnet (TCP port 80, /22 at most), then the system neighbour table | every device present and its MAC address |
| MAC vendor lookup in the IEEE registries (copy included) | the manufacturer, even when the device announces nothing |
| UPnP / SSDP | manufacturer and model on routers, NAS, media devices |
| mDNS / DNS-SD (Bonjour) | device name and model on NAS, printers, cameras, smart home |
| Title and login prompt of the device's web admin page (HTTP, then HTTPS) | the model, on many routers and NAS |
| Port forwards opened on the router through UPnP (read-only query) | the devices reachable from the Internet |

A copy of the IEEE MAC registries ships with the tool; `lastpatch update-oui` optionally refreshes it from the IEEE website. Every probe contacts private addresses only, sends no credentials, and nothing leaves your network. Only scan networks you own or administer.

Devices that announce nothing (phones with random MAC addresses, devices without a web page) are listed with "model not announced": check them with `lastpatch check`.

## The dataset

`data/devices.json` (schema in `data/schema.json`), version 0.3.0, retrieved 2026-11-01: 1,649 devices from 13 vendors.

| Vendor | Rows | Devices | Source |
|---|---|---|---|
| TP-Link | 1,354 | routers, mesh, cameras, smart home, switches, access points | UK PSTI statement of compliance (full document) |
| ASUS | 85 | routers, mesh | UK PSTI support-period list; Singapore lifecycle list |
| AVM (FRITZ!) | 62 | routers, repeaters | FRITZ! product support status page |
| Ring | 25 | doorbells, cameras | UK PSTI statements; US lifecycle page |
| EZVIZ | 23 | cameras | EZVIZ EOL product list (Europe) |
| Reolink | 22 | cameras | UK PSTI statements |
| Synology | 20 | NAS | DSM end-of-life announcements per model series |
| Linksys | 19 | routers, mesh | Linksys end-of-life article |
| D-Link | 14 | routers, mesh | US end-of-support notices; UK PSTI statements |
| Arlo | 10 | cameras, doorbells | Arlo end-of-life page; UK PSTI statements |
| QNAP | 6 | NAS | QNAP support status; UK PSTI statements |
| Netgear | 5 | routers, mesh | UK PSTI statements (no dates published) |
| Netatmo | 4 | cameras, doorbells | UK PSTI statements |

Each row records the date exactly as written (`support_end_raw`), whether it is a minimum guarantee (`end_is_minimum`, for "or later" / "at least"), the hardware version it applies to, the market (`region`) and the source URL.

### Known limits

- **Hardware versions matter.** The same model can have different dates per hardware revision (e.g. Tapo C200 V3 vs V5). Check the label under the device.
- **Sources sometimes contradict themselves.** When one document gives two dates for the same model and hardware version, the earlier date is kept and the build reports the conflict.
- **Dates differ by market.** ASUS publishes different dates in the UK and Singapore for the same model. Rows are never merged across regions.
- **Some vendors publish no usable date.** Netgear UK statements only say support ends at "End of Service"; D-Link UK statements say "2 years" without a start date. These rows are `unknown`.
- **Synology and QNAP publish few per-model dates.** Their status pages give categories ("limited updates") rather than end dates for current models, so recent NAS models are not listed yet.
- **ISP boxes are out of scope.** Routers supplied by internet providers (Livebox, Freebox, etc.) are updated by the provider.

## Keeping the dataset current

A weekly GitHub Action (`.github/workflows/watch-sources.yml`) downloads every official source the dataset cites, plus the index pages that link to new documents (`data/source-indexes.json`), and compares fingerprints with `data/sources-state.json`:

- PDF files: hash of the bytes; web pages: hash of the visible text, so layout changes do not raise alerts;
- index pages: new or removed document links.

When something changed, it opens (or comments on) an issue labelled `source-watch`. After reviewing and updating the rows, run `node scripts/watch-sources.js --update` to accept the new fingerprints. Each source keeps a history of its fingerprints.

## Contributing data

Add rows to a file in `raw/`, then run `npm run build:data`. Rows without a source URL or with a malformed date are rejected. Only official manufacturer documents are accepted.

## Roadmap

**Dataset**
1. ~~Automatic source monitoring~~ (done in 0.4.0).
2. Date history: keep every published version of a date, to spot a vendor shortening a support period (the UK PSTI regime forbids it).
3. ~~Confidence level per date~~ (done in 0.5.0). Next: estimate from the last firmware release when no date is published.
4. More vendors and markets, prioritised by exposure to attacks and availability of official data; last firmware release date as a fallback signal for vendors that publish no end-of-support date.

**Detection and risk**
5. ~~Better LAN discovery~~ (done in 0.4.0). Next: optional expert mode using a locally installed Nmap (called, never bundled).
6. Installed vs latest firmware: flag devices that are supported but not updated.
7. ~~Actively exploited vulnerabilities (CISA KEV)~~ (done in 0.5.0).
8. ~~Internet exposure through UPnP port forwards~~ (done in 0.5.0).

**Products**
9. Website with one page per model.
10. Desktop apps for macOS, Windows and Linux, with alerts before a device reaches end of support (low-cost subscription including dataset updates).
11. Browser extension showing the support end date on retailer product pages, before purchase.
12. Replacement advice: models ranked by remaining support period (any affiliate links disclosed, ranking never based on commission).
13. Paid API for retailers and marketplaces that must disclose support periods under the EU Cyber Resilience Act (from December 2027).
14. PDF report for small businesses (device inventory, devices to replace).
15. Localisation and outreach to consumer associations, national cybersecurity agencies and the press (yearly report).

## License

- Code: MIT (see `LICENSE`).
- Exploited vulnerabilities extract (`data/kev.json`): CISA KEV catalogue, a U.S. Government work in the public domain.
- MAC vendor table (`data/oui.tsv`): public IEEE MA-L/MA-M/MA-S registries, as packaged by the `oui-data` npm package (BSD-2-Clause); regenerate with `npm run update:oui`.
- Dataset (`data/devices.json`): Open Database License (ODbL) 1.0 (see `data/LICENSE`). You may reuse it, including commercially, but you must attribute LastPatch and share any database you derive from it under the same license.
