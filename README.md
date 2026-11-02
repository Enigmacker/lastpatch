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

`data/devices.json` (schema in `data/schema.json`), version 0.4.3, retrieved 2026-11-02: 4,645 rows from 45 brands.

| Vendor | Rows | Source |
|---|---|---|
| TP-Link | 1,354 | UK PSTI statement of compliance (full document) |
| D-Link | 473 | US legacy product list; security announcements; US end-of-support notices; UK PSTI statements |
| Zyxel | 368 | Service-provider end-of-life list; UK PSTI page; archived EOL list; end-of-life page |
| Linksys | 287 | Linksys product end-of-life page (per market); end-of-life article |
| Netgear | 256 | NETGEAR for Business end-of-life list (home and small-office models); UK PSTI statements |
| Tenda | 136 | Tenda EOL Center ("End of service date") |
| Mercusys | 127 | UK PSTI statement of compliance (full document) |
| ASUS | 85 | UK PSTI support-period list; Singapore lifecycle list |
| Ring | 85 | Ring device software security updates pages (UK, US); UK PSTI statements |
| DrayTek | 84 | DrayTek UK product lifecycle and end-of-life pages |
| Amazon (Echo, Fire TV) | 73 | Amazon device software security updates pages (UK, US) |
| AVM (FRITZ!) | 62 | FRITZ! product support status page |
| Google (Nest, Google Wifi) | 40 | Google guaranteed software update periods page |
| Xiaomi | 39 | Xiaomi end-of-life product list (no dates) |
| Ubiquiti | 29 | Ubiquiti legacy products list (no dates) |
| EZVIZ | 311 | EZVIZ EOL product list (Europe, firmware update end dates) |
| Reolink | 22 | UK PSTI statements |
| Synology | 152 | Software life cycle policy (DSM, SRM, cameras, BeeStation); DSM 6.2 end-of-life announcement |
| Asustor | 51 | ADM end-of-support notices and product status table |
| WD (My Cloud) | 46 | WD product life cycle policy; My Cloud OS 3 end-of-support notice |
| TerraMaster | 11 | TerraMaster end-of-support announcements |
| Blink | 18 | Blink device software security updates page |
| eero | 17 | eero software security updates page |
| devolo | 15 | UK PSTI statements |
| Arlo | 102 | Arlo end-of-life page; UK and Australian statements of compliance |
| Lorex | 76 | Lorex UK PSTI end-of-life table |
| Hive | 48 | Hive UK PSTI statement (October 2026); Hive product news |
| GL.iNet | 53 | GL.iNet discontinued products page; end-of-life notices; UK PSTI support period page |
| Teltonika | 52 | Teltonika EOL products page |
| Keenetic | 34 | Keenetic warranty and support periods page of each model |
| Cisco (RV, Meraki Go) | 21 | Cisco end-of-life notices (End of Vulnerability/Security Support); Meraki EOL table |
| Edimax | 8 | Edimax end-of-support announcement |
| Nooie | 7 | Nooie security updates page (no dates) |
| QNAP | 6 | QNAP support status; UK PSTI statements |
| Aqara | 18 | UK PSTI statements |
| Bosch Smart Home | 17 | Bosch Smart Home software and security updates page |
| Shelly | 17 | UK PSTI statements (newer devices only) |
| Nuki | 15 | UK PSTI statements |
| tado° | 6 | UK PSTI statements |
| Samsung SmartThings | 2 | SmartThings hub retirement notice |
| eufy, Netatmo, Yale, Philips Hue, Wyze | 13 | UK PSTI statements; end-of-support pages |

Each row records the date exactly as written (`support_end_raw`), whether it is a minimum guarantee (`end_is_minimum`, for "or later" / "at least"), the hardware version it applies to, the market (`region`) and the source URL.

### Known limits

- **Hardware versions matter.** The same model can have different dates per hardware revision (e.g. Tapo C200 V3 vs V5). Check the label under the device.
- **Sources sometimes contradict themselves.** When one document gives two dates for the same model and hardware version, the earlier date is kept and the build reports the conflict.
- **Dates differ by market.** ASUS publishes different dates in the UK and Singapore for the same model. Rows are never merged across regions.
- **Some vendors publish no usable date.** Netgear UK statements only say support ends at "End of Service"; D-Link UK statements say "2 years" without a start date; Hikvision, Swann, Imou, Sonos, Logitech, SimpliSafe, Foscam, Amcrest, IKEA, Somfy, SONOFF, SwitchBot, Cudy and Aruba Instant On publish no per-model dates (some give only rules such as "three years after purchase"). Xiaomi and Ubiquiti only list products that no longer get updates, without dates.
- **Minimum guarantees run out.** Google, Amazon, ASUS and others promise updates "until at least" a date. Once it has passed, the device is shown as no longer supported, with a note that updates may still come.
- **Keenetic** pages give three dates; the dataset uses the end of "Limited updates", the last phase in which security updates are promised, not the later "support discontinuation" date.
- **Tenda's "End of service date"** is often a day after its end of sale. Tenda's UK PSTI page promises security support for 3 years after end of life in the UK, without a per-model table, so UK units may be supported longer.
- **Recent NAS models have no dates yet.** Synology gives dates per DSM version, and models on DSM 7.2 or later have no announced end. QNAP's status page shows one model at a time and could not be read in bulk yet.
- **ISP boxes are out of scope.** Routers supplied by internet providers (Livebox, Freebox, etc.) are updated by the provider.

## Keeping the dataset current

A weekly GitHub Action (`.github/workflows/watch-sources.yml`) downloads every official source the dataset cites, plus the index pages that link to new documents (`data/source-indexes.json`), and compares fingerprints with `data/sources-state.json`:

- PDF files: hash of the bytes; web pages: hash of the visible text, so layout changes do not raise alerts;
- index pages: new or removed document links.

When something changed, it opens (or comments on) an issue labelled `source-watch`. After reviewing and updating the rows, run `node scripts/watch-sources.js --update` to accept the new fingerprints. Each source keeps a history of its fingerprints.

## Website

`site/` is the public website: an Astro static site in English and French, with one page per model, a page per brand and per device type, the devices whose support ends within a year, and the devices no longer supported. The search runs in the browser; the site sets no cookies.

English pages live at the root and French pages under `/fr/`, with French words in the addresses (`/fr/appareils/…`, `/fr/marques/…`, `/fr/routeurs/…`). Every page links to its counterpart with `hreflang` and a language switch. All wording is in `site/src/i18n/en.ts` and `fr.ts`; pages are shared views in `site/src/views/`, and the route files in `site/src/pages/` only pick the view. Adding a language means adding a dictionary and its route files.

```sh
cd site
npm ci
npm run dev          # http://localhost:4321
npm run build        # dist/, then: npm run check:site
```

`scripts/prepare-data.mjs` turns `data/devices.json` and `data/kev.json` into the data the pages use, with the same matching and status rules as the CLI. Statuses depend on the build date, so the site must be rebuilt regularly (at least weekly) to stay right; `BUILD_DATE=YYYY-MM-DD` fixes the date for a reproducible build.

Deployment (Dokploy or any Docker host) uses the `Dockerfile` at the repository root, which builds the site and serves it with `site/server.mjs` (no dependencies, security headers, health check on `/healthz`). Build arguments: `SITE_URL` (default `https://lastpatch.org`), `NOINDEX=true` for a staging copy, `UMAMI_SCRIPT_URL` and `UMAMI_WEBSITE_ID` for optional cookie-free statistics.

## Contributing data

Add rows to a file in `raw/`, then run `npm run build:data`. Research batches are imported with `node scripts/import-research.js <batch.json> raw/<name>.json`, which applies the cleanup rules decided on review (canonical source addresses, one model per Linksys market SKU, ambiguous dates left out). Rows without a source URL or with a malformed date are rejected. Only official manufacturer documents are accepted.

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
9. ~~Website with one page per model~~ (done in 0.6.0), ~~in French too~~ (done in 0.7.0). Next: more languages, alerts by email.
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
