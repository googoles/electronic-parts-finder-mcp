---
name: parts-sourcing
description: Use when the user asks to find, compare, replace, or source embedded parts, cables, connectors, motors, sensors, modules, power supplies, or related engineering components.
---

# Parts Sourcing

Use the bundled `parts-finder` MCP server for read-only sourcing work.

## Workflow

1. Extract hard constraints first: part family, electrical ratings, package, connector keying, cable length, motor voltage/power, interface, temperature range, stock, price, MOQ, and compliance.
2. If a missing constraint could materially change the answer, ask one concise question. Otherwise search with explicit assumptions.
3. Prefer authorized distributors such as Mouser and DigiKey for production or reliability-sensitive recommendations.
4. Use AliExpress only when marketplace-style sourcing is appropriate, such as modules, cables, harnesses, adapters, motors, prototyping accessories, or low-cost long-tail candidates. Pass `marketplaceAllowed: true` explicitly.
5. Keep all actions read-only. Do not place orders, create carts, call dropshipping APIs, or mutate supplier accounts.

## Tool Selection

- Use `lookup_part` when the user provides a likely exact MPN, supplier part number, or top marking.
- Use `search_parts` when the user gives a rough description, category, visual hints, or incomplete part number.
- Use `compare_parts` when choosing between known candidates.
- Use `suggest_alternates` when stock, lifecycle, price, lead time, or second-source risk is the reason for searching.
- Use `enrich_bom` for multiple BOM rows instead of many separate single-part calls.

Pass hard requirements into `constraints` rather than only putting them in free text. Useful constraints include `manufacturer`, `mustHave`, `mustNotHave`, `inStockOnly`, `maxUnitPrice`, `maxMoq`, `rohsOnly`, and `marketplaceAllowed`.

Korean field wording is acceptable for common part terms. The MCP normalizes phrases such as `2핀`, `커넥터`, `패널마운트`, `방수`, `기어모터`, and `엔코더` into supplier-friendly English query variants, but exact English terms or visible markings still improve results.

If `visualHints` are omitted, the MCP still infers common connector and motor hints from the query text, including pin count, row count, pitch, connector family, mounting style, color, wire count, encoder, and gearhead clues.

## Image-Based Requests

When the user provides an image, use vision first and extract searchable hints before calling MCP tools:

- visible text, logos, top markings, and polarity marks
- package type, pin count, pin layout, and lead style
- connector pin count, pitch, keying, latch style, shell shape, and color
- connector row count, family, gender/type, mounting style, and orientation when visible
- cable wire count, length estimate, connector family, and jacket markings
- motor body size, shaft diameter, gearhead, encoder, wire count, and connector type
- board context, such as nearby crystal, regulator, isolation slot, motor driver, CAN/RS-485 transceiver, USB, screw terminal, or power input
- scale references, such as ruler marks, pin header pitch, USB connector, or screw terminal size

Call `extract_visual_part_hints` with those observations, then pass the returned draft or refined hints into `search_parts`. Treat image-derived matches as tentative until verified by datasheet, exact markings, or measured dimensions.

For connector images, search quality improves when you include row count, pitch, connector family, mounting style, and gender/type in the query text or visual hints. For example, prefer `2x10 IDC box header 2.54mm ARM JTAG through hole header` over only `black connector`.

## Rate Limits

Respect supplier quotas and cache whenever possible:

- Mouser default planning quota is 30 requests/minute and 1000 requests/day, but verify against the current account/API response behavior.
- DigiKey Product Information standard quota is 120 requests/minute and 1000 requests/day; honor `Retry-After`, `X-RateLimit-*`, and `X-BurstLimit-*`.
- AliExpress quotas vary by appkey, API, and API+appkey; use values from the Open Platform console after approval.

## Output Expectations

For every recommendation, include:

- supplier
- manufacturer part number when available
- supplier part number or listing ID
- confidence and fit summary when returned
- stock or availability text
- price basis and currency when available
- datasheet or product URL
- fetched timestamp
- caveats
- verification checklist items that remain before purchase

For alternates, call out package, pinout, voltage/current/power, firmware, certification, connector keying, mechanical fit, and marketplace authenticity risks.

## Current Credential State

The project `.env` intentionally leaves API keys blank until the user obtains them. If tools report skipped suppliers, explain which credential names are missing and continue with any configured suppliers.
