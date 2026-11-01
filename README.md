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
    source : https://fritz.com/pages/status-produktunterstuetzung [EU]
```

Options: `--json` for machine-readable output, `--warn <days>` to change the "ending soon" window (default 365), `--region <cc>` to prefer dates published for a given market. Exit code `2` means at least one device is past its end of support, so the tool can be used in scripts.

## What the scan does

`lastpatch scan` sends standard SSDP/UPnP discovery requests on your local network and reads the description each device advertises (manufacturer, model). It is read-only, contacts private addresses only, and sends nothing outside your network. Devices with UPnP disabled do not answer: check those with `lastpatch check`.

## The dataset

`data/devices.json` (schema in `data/schema.json`), version 0.2.0, retrieved 2026-11-01: 338 devices from 13 vendors.

| Vendor | Rows | Devices | Source |
|---|---|---|---|
| ASUS | 85 | routers, mesh | UK PSTI support-period list; Singapore lifecycle list |
| AVM (FRITZ!) | 62 | routers, repeaters | FRITZ! product support status page |
| TP-Link | 43 | routers, Deco, Tapo cameras | UK PSTI statement of compliance |
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
- **Dates differ by market.** ASUS publishes different dates in the UK and Singapore for the same model. Rows are never merged across regions.
- **Some vendors publish no usable date.** Netgear UK statements only say support ends at "End of Service"; D-Link UK statements say "2 years" without a start date. These rows are `unknown`.
- **Synology and QNAP publish few per-model dates.** Their status pages give categories ("limited updates") rather than end dates for current models, so recent NAS models are not listed yet.
- **ISP boxes are out of scope.** Routers supplied by internet providers (Livebox, Freebox, etc.) are updated by the provider.

## Contributing data

Add rows to a file in `raw/`, then run `npm run build:data`. Rows without a source URL or with a malformed date are rejected. Only official manufacturer documents are accepted.

## Roadmap

1. Full extraction of the TP-Link PSTI document (many more models than currently listed).
2. Better LAN discovery without extra tools or admin rights: list every device from the system neighbour table, identify the vendor from the MAC address (IEEE registry), read the model from the device's admin page title and from mDNS/DNS-SD announcements, alongside UPnP. Optional expert mode using a locally installed Nmap (called, never bundled).
3. Installed vs latest firmware: flag devices that are supported but not updated, and use the last firmware release date as a signal for vendors that publish no end-of-support date.
4. Website with one page per model, then desktop apps for macOS, Windows and Linux.

## License

- Code: MIT (see `LICENSE`).
- Dataset (`data/devices.json`): Open Database License (ODbL) 1.0 (see `data/LICENSE`). You may reuse it, including commercially, but you must attribute LastPatch and share any database you derive from it under the same license.
