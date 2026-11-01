# Changelog

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
