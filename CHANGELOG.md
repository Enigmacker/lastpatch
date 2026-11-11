# Changelog

## 0.9.2 - 2026-11-11

From the first scan of a real network:

- The IEEE name of GL.iNet ("GL Technologies (Hong Kong) Limited") is matched to the brand.
- GL.iNet routers on firmware 4.x publish their model only after login. The scan now recognises them from the first login step (the "challenge", no password sent) and says so, instead of "model not announced".
- Matching: a full product name now beats a shorter one from another maker ("Floodlight Cam E340" was matched to Ring Floodlight Cam). A model code shared by several products of one maker ("eufy E340": a camera and two doorbells) lists them to choose from instead of "not in the dataset" (`suggestions` in JSON output).
- Devices with a private (randomised) MAC address, usually phones, tablets and computers, are reported as such instead of "unknown device". JSON output has `random_mac` and `note`.

## 0.9.1 - 2026-11-11

- QNAP: 219 models from the full QNAP product support status table (NAS, routers, switches), read from the page's data feed, replace the hand-copied rows. Month-only dates ("2027-12") are read as the last day of that month; models marked "EOL" have no date.
- New `scripts/update-vendor-lists.js` (`npm run update:vendors`) mirrors the QNAP table and the full Linksys end-of-life table (`productTable.js`). The weekly Action runs it and opens a pull request when a list changed. When a mirrored list exists, hand-copied rows from the same page are dropped at build time.
- New `data/manual-checks.json`: sources the watch cannot read, checked by hand on 2026-11-11 (1,078 rows compared; no wrong date found, one disagreement between two D-Link documents noted). Netatmo (site in maintenance) and TerraMaster (bot check) are still to be checked.
- Matching: a row whose raw text says the device is already end-of-life is matched as such.
- 5,089 rows from 45 brands.
- Website address: https://getlastpatch.com (default `SITE_URL`).

## 0.9.0 - 2026-11-11

- Installed vs latest firmware. `lastpatch check "<model>" --firmware <version>` compares the version installed on a device with the latest one the manufacturer publishes; `lastpatch scan` reads the installed version where the device publishes it and says whether an update is available. JSON output has a `firmware` block (`installed`, `latest`, `latest_release_date`, `upToDate`, `behind`, `note`). When the latest version is not known, or depends on a hardware version that was not given, `upToDate` is `null`: a device is never reported as up to date without it.
- Version strings are compared as numbers, including AVM formats ("154.07.57", "07.57", "FRITZ!OS 8.51") and generic ones ("V1.1.0 Build 20230512 rel.123", "1.0.4.126_10.1.12").
- The scan reads the installed version, read-only and without credentials, from `jason_boxinfo.xml` or the TR-064 description on FRITZ!Box routers, `currentsetting.htm` on NETGEAR routers, and the `firmwareVersion` / `softwareVersion` elements of UPnP descriptions. Lab versions and provider-branded FRITZ!Box firmware are flagged. The serial number in these files is not kept.
- New data file `data/firmware.json` (schema in `data/firmware-schema.json`): 9 FRITZ!Box models read from AVM's download server on 2026-11-11. `scripts/update-firmware.js` refreshes it from the same server for every FRITZ!Box in the dataset; it runs in the weekly GitHub Action.

## 0.8.5 - 2026-11-11

- Source watch: web pages are compared on the lines that name a model or repeat an end date from the dataset, not on the whole page text. In its second weekly run the old method flagged 33 pages, mostly for menus, banners and related articles. Changes now list the lines added and removed.
- Source watch: a source that keeps failing is reported once, then summarised; pages filled in by a script are listed as needing a browser check instead of passing silently.

## 0.8.4 - 2026-11-02

- Dataset 0.4.4: 4,871 rows from 45 brands. Netgear consumer End of Service dates (Nighthawk, Orbi kits, extenders, cable modems) and the Australian list as minimum dates (375 Netgear rows); the full eufy UK table (113 rows instead of 5).
- Left out on review: standalone Orbi routers dated from their kits (an inference), and QNAP dates read only once.

## 0.8.3 - 2026-11-02

- Dataset 0.4.3: 4,645 rows from 45 brands. Smart home: Hive (48), Aqara (18), Bosch Smart Home (17), Shelly (17), Nuki (15), Netatmo (13), tado° (6), Samsung SmartThings (2). Nuki dates are minimum guarantees.

## 0.8.2 - 2026-11-02

- Dataset 0.4.2: 4,517 rows from 39 brands. Routers for homes and small offices: GL.iNet (53), Teltonika (52), Keenetic (34), Cisco RV and Meraki Go (21), Edimax (8).

## 0.8.1 - 2026-11-02

- Dataset 0.4.1: 4,349 rows from 34 brands. Cameras: Arlo complete (UK and Australian statements, 102 rows instead of 10), Lorex (76), the full EZVIZ European list (311 instead of 23), Hive and Nooie.
- Matching recognises the next brands being researched (GL.iNet, Cudy, Teltonika, Keenetic, Cisco, Aruba Instant On, tado, Bosch, Nuki, Shelly, IKEA, Hive, Somfy, Sonoff, Aqara, SwitchBot, SmartThings and camera brands).

## 0.8.0 - 2026-11-01

- Dataset 0.4.0: 3,882 rows from 31 brands (was 1,649 rows, 13 brands). New: Asustor, WD My Cloud, TerraMaster, eero, Blink, Amazon Echo and Fire TV, Google Nest and Google Wifi, Mercusys, Tenda, Zyxel, DrayTek, devolo, Xiaomi, Ubiquiti, eufy, Yale, Philips Hue, Wyze. Expanded: D-Link (US legacy list, security announcements), Linksys (per-market end-of-life page), Netgear (business EOL list), Ring (UK and US update pages), Synology (software life cycle policy: 152 rows instead of 20).
- Exploited vulnerabilities: the CISA subset now covers the new brands (164 entries); 24 devices match.
- Schema: region accepts vendor sales regions (EMEA, APAC, LATAM).
- New `scripts/import-research.js` to import research batches with the cleanup rules decided on review.

## 0.7.0 - 2026-11-01

- Website in French: every page exists under /fr/ with French addresses, titles and descriptions written for French searches ("fin de support", "mises à jour de sécurité"), French dates and typography, a French search index and social image.
- Both languages share the same views; all wording lives in one dictionary per language. Pages declare their counterpart (hreflang, og:locale:alternate) and offer a language switch.
- When every date of a device is a minimum guarantee that has passed, its page says the guarantee period is over instead of saying updates stopped.
- Matching recognises about twenty more brands, and discovery accepts sibling brands of the same company (Ring with an Amazon network card, Mercusys with a TP-Link one).

## 0.6.1 - 2026-11-01

- Website design: ink header and footer, a home page hero showing where the model and hardware version are printed on the device label, status bars for the whole dataset, each brand and each device type, a support timeline per hardware version on device pages, dark mode.
- Website SEO: titles phrased as people search ("<model> end of life: security updates until <date>"), one page per device type (/routers/, /security-cameras/, ...), structured data for device pages (WebPage about a Product) and lists (ItemList), sitemap with last-modified dates and priorities, a richer footer with links to every type and the main brands.

## 0.6.0 - 2026-11-01

- Website (`site/`): Astro static site with one page per model giving the support end date, the source document, the dates per hardware version, the exploited vulnerabilities and what to do; pages per brand, devices ending within a year, devices no longer supported, methodology and privacy. Search in the browser, no cookies, strict Content Security Policy, structured data (FAQ, breadcrumbs, dataset).
- Deployment: Dockerfile for Dokploy and a dependency-free static server with security headers.
- CI: the site is built and checked (titles, descriptions, canonicals, one h1 per page, no inline scripts, internal links).

## 0.5.0 - 2026-11-01

- Actively exploited vulnerabilities: results list the CISA KEV entries that apply to the model (62 entries for the covered vendors, catalogue 2026.10.30), respecting the hardware versions CISA names; models missing from the dataset are checked too. Weekly refresh in the source watch workflow.
- Internet exposure: the scan reads the router's UPnP port forwards (read-only) and shows which devices are reachable from the Internet.
- Confidence: every result states its basis (official end date, minimum guarantee, vendor statement without date, no date).

## 0.4.1 - 2026-11-01

- Scan: a copy of the IEEE MAC registries (MA-L, MA-M, MA-S) now ships with the tool, so manufacturers are recognised without any setup; longest prefix wins. `lastpatch update-oui` is optional.
- Scan: the admin page probe also reads the HTTP login prompt (realm), which often names the exact model, and falls back to HTTPS; the sweep also checks port 443.

## 0.4.0 - 2026-11-01

- Scan: new discovery combining a light subnet sweep and the neighbour table, MAC vendor lookup (IEEE registry, `lastpatch update-oui`), UPnP, mDNS/DNS-SD and the web admin page title. Lists every device, including those that announce nothing. No admin rights, no dependency.
- Matching: vendor names now match whole words only ("Engineering" is no longer read as "Ring").
- Source watch: weekly GitHub Action that fingerprints every official source and index page, opens an issue when one changes, and keeps a fingerprint history.
- Roadmap: every planned improvement listed.

## 0.3.0 - 2026-11-01

- Dataset: 1,649 devices. The whole TP-Link UK PSTI document is now included (1,354 rows: routers, mesh, Tapo cameras and smart home, switches, access points), instead of a selection of 43.
- Build: hardware version typos are normalised ("5" -> "V5"); when a source gives two dates for the same model and hardware version, the earlier date is kept and the conflict is reported.
- Roadmap: native LAN discovery (neighbour table, MAC vendor, admin page title, mDNS).

## 0.2.0 - 2026-11-01

- Dataset: 338 devices from 13 vendors. Added NAS (Synology, QNAP) and cameras / smart home (Reolink, EZVIZ, Arlo, Ring, Netatmo).
- Matching: model names with a SKU in parentheses now match on the name or the SKU.
- ASUS UK dates are recorded as minimum guarantees, as stated on the vendor's current support page.
- CI: unit tests, dataset integrity check, and reproducible dataset build.

## 0.1.0 - 2026-11-01

- First prototype: 228 routers, mesh systems and Tapo cameras (TP-Link, AVM, ASUS, Linksys, Netgear, D-Link), each with its official source.
- `lastpatch check`, `scan` (SSDP/UPnP) and `list` commands, JSON output, exit code 2 when a device is past end of support.
