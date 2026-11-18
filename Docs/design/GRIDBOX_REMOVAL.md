# Gridbox removal inventory (Phase 2, step 1)

**As of:** 19 Nov 2026, branch `cleo-overhaul/phase-2-frontend` (base `main` `ffdef82`).
**Scope:** `index.html` (app), `landing.html` (public landing), `admin/index.html` + `assets/admin/admin.css` (admin console).
**What "gridbox" means here:** the look the owner wants gone — visible box-grid backgrounds, lit canvas grids, boxed panels and floating boxed chrome, glows, grain, rim highlights on content, and other techy decoration. Each row says what replaces it under the Apple-based system in [`DESIGN_GUIDELINES.md`](DESIGN_GUIDELINES.md). Line numbers are for `main` at `ffdef82`.

> `landing.html:1653` is a single 707,043-character line holding the screen captures (`#screen-data`), which embed a copy of the app's CSS. Grep counts for `landing.html` include that copy. The captures are regenerated from the rebuilt app with `tools/capture-screens.js`, so they need no hand edits.

## 1. Current font families (keep exactly)

| Family | Files / stack | Where |
|---|---|---|
| **Cleo Sans** (Helvetica Neue, licensed) | `assets/fonts/HelveticaNeueLight.otf` 300, `HelveticaNeueRoman.otf` 400, `HelveticaNeueMedium.otf` 500, `HelveticaNeueBold.otf` 700; stack `"Cleo Sans","Helvetica Neue",Helvetica,Arial,sans-serif` | `index.html:76-79,84`; `landing.html:46-48` (preload), `70-73`, `82` (stack adds `system-ui,"Segoe UI",Roboto`); `assets/admin/admin.css:8-11,15`; `legal/*.html:13-15,20` |
| Monospace (receipts, codes) | `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace` | `index.html:794,1885,2325` |
| Icons | Phosphor 2.1.1 (regular, fill, bold) — one icon set | `assets/icons/phosphor/*/style.css` |
| Landing capture subsets | WOFF2 subsets of Cleo Sans and `CleoGlyph*` icon subsets inside `#screen-data` | `landing.html:1653` |

No Google Fonts or other font CDN is used.

## 2. App (`index.html`)

| # | Pattern | Where | Remove / replace with |
|---|---|---|---|
| A1 | **Ambient lit box grid** (canvas `amb-grid`, 18px cell, 5px gap, 3.5px radius) behind sign-in, setup, loading, mode picker | CSS `index.html:267-273`; JS `ambient` `index.html:3418-`; `data-amb` attributes | Delete canvas, CSS and module. Plain system background (`--bg-grouped`) |
| A2 | **Ripple** engine (organic ripples through the grid and marks) | `index.html:3357-3417` | Delete |
| A3 | **2D lit emblem** `gridMark` (sign-in on narrow screens) | `index.html:4347-` | Static emblem image (`assets/brand/cleo-emblem.svg`) |
| A4 | **WebGL 3D pillar emblem** `emblem3d` + red radial glow behind it | JS `index.html:4518-`; CSS `.login-art.is-3d::before` `index.html:641-655,836` | Delete; sign-in becomes a single centred form with the static lockup |
| A5 | **Loading screen** emblem lit in grid boxes + ripples (`boot()`) | `index.html:4278-` | Static lockup with a native-style activity indicator; progress text kept for assistive tech |
| A6 | **Grain overlay** (`body::after` SVG noise, `--grain-opacity`) | `index.html:140,205,274-279` | Delete |
| A7 | **Liquid-glass refraction on every `.glass` / `.glass-thick` / `.lg`**, including content cards (SVG displacement maps, `--refract`) | CSS `index.html:288-313`; `LiquidGlass` `index.html:3715-3834` | Keep glass **only** on navigation and overlays (sidebar, toolbar, tab bar, sheets, popovers, menus, floating cart summary) with the new tokens; content cards become solid `--bg-elevated`. Drop the SVG displacement refraction (Chromium-only, smears content) |
| A8 | **Embossed rim** (`--rim-edge`, `--rim-light`, `--rim-catch` inset shadows via `::before`) | `index.html:127-129,299-305` | One hairline `--glass-border` + `--glass-specular` top edge on glass only; solid surfaces get no rim |
| A9 | **Pointer sheen** (`.sheen::after` radial highlight) | `index.html:316-323` | Delete |
| A10 | **Accent glow** (`--accent-glow`) | `index.html:103,173` | Delete; primary buttons use a flat fill and the single top-light shadow |
| A11 | **"Lit box" selection** — accent-soft fill + 2px red inset ring on `.chip`, `.pm-opt`, `.titem`, `.opt`, `.staff`, `.method`, `.more-tile`, `.tile.added` | `index.html:456,1000,1863,2165,2233,2255,2288,2364` | Apple selection: tinted fill (`--accent-fill`) + checkmark for multi-select; segmented thumb for single-select. No rings |
| A12 | **Floating boxed chrome** — sidebar as a floating rounded card, top bar as a floating capsule, Terminal rail as a boxed column | web-shell CSS `index.html:1331-`; terminal CSS `index.html:2068-` | macOS full-height sidebar flush to the window edge (glass), unified toolbar (glass); iPadOS tab/side bar on the Terminal |
| A13 | **Device stage / preview chrome** (`.stage.framed` double-ring bezel, `.stage-wrap` radial backdrop, "Terminal preview · 2048 × 1280" bar, Device frame / Hide buttons) | `index.html:2075-2080,12560-12589` | Terminal fills the viewport; developer preview controls only behind `?dev` |
| A14 | **Boxed KPI strips** with internal dividers (Dashboard, Back Office Overview, Shift, Z-reading) | owner/backoffice CSS `index.html:1684-2067` | Large numbers grouped by spacing on one solid card or on the grouped background, hairline separators only between groups |
| A15 | **Tinted icon squares** (Quick actions, Needs your attention, Flagged activity) and `.cat-dot` category dots on product tiles | `index.html` owner/backoffice CSS; `.cat-dot` (2 hits) | Plain Phosphor icons in `--ink-2`; product tiles show the product name large, price in tabular numerals |
| A16 | **Decorative dashed borders** (`.plan-tab.t-quiet`, `.plan-opt.tier-quiet`, `.empty-note`, `.tile.add-tile`, `.scan-test`) | `index.html:731,868,900,2444,2542` | Empty states become a centred icon + title + one action; "add" tile becomes a plain secondary button |
| A17 | **Plan "looks"** — red rim/glow on Pro, gold edge on Max, dark gold Enterprise panel, the plan tab with circuit-tree logo in working chrome | `index.html:868-907`; `Cleo.planLogo` | Plans differ by content, not material. The plan tab leaves working chrome (plan lives in Settings › Plan and billing); the recommended plan gets the one accent button |
| A18 | **Contribution-style "Activity" heatmap** (26-week box grid on the Owner Dashboard) | `index.html` owner.js (`charts.js` `index.html:6549-`) | Remove from the dashboard (decorative); "Busiest hours" stays as a chart |
| A19 | **Receipt trivia** ("110 laps of a running track") on the dashboard | `index.html:9247` | Remove |
| A20 | **Mode-picker wireframe thumbnails** with a glowing red chart line | launcher CSS `index.html:2755-` | SF-style symbol icon + title + one-line description in an inset grouped list |
| A21 | **Red sparklines and "Consolidated" badge** on the branch picker | branch screen `index.html:5647-` | Neutral sparklines in `--ink-3`; badge removed (the "All branches" row says it) |

## 3. Landing (`landing.html`)

| # | Pattern | Where | Remove / replace with |
|---|---|---|---|
| L1 | **Full-page lit box grid** canvas (`grid`, red/maroon/orange/slate lights, light wash, pointer illumination) | JS `landing.html:984-1230`; `.grid-canvas` `landing.html:406,450`; `.grid-on` | Delete. Solid page background in light and dark (the landing follows the system theme) |
| L2 | **CSS fallback grid** `.ground` + `.ground::after` (18px SVG box tile) with red radial gradients | `landing.html:402-405` | Delete |
| L3 | **Circuit trace** connecting sections (`trace`, `traceField`, `.trace-row` 96px/72px channel, `.trace-bus`) | JS `landing.html:1037-1072,1281-1399`; CSS `landing.html:175-177,329,343-346,377` | Delete the channel; sections become full-width rows grouped by spacing |
| L4 | **Trace ports** (22px circles on panel rims and price cards, lit red when reached) | `landing.html:441-447` | Delete |
| L5 | **Ripple** engine | `landing.html:939-983` | Delete |
| L6 | **Lit-matrix emblems** at the opening and closing (`marks`, `markCols`) and gliding footer strands | `landing.html:1231-1280,1400-` | Static emblem; closing section is a plain call to action |
| L7 | **Footer halo** (`text-shadow` in the ground colour so type reads over lit boxes) | `landing.html:410-411` | Delete (nothing behind the footer any more) |
| L8 | **Rim highlights and glass on content panes** (`--rim`, `--rim-top`, `--rim-light`, `--rim-catch`, `.glass` with refraction on content) | `landing.html:78,117,123,317,401` | Glass only on the sticky nav and dialogs; content is solid |
| L9 | **Tier glows** — red radial light on Pro (`.tier-animated`), gold edge and light on Max (`.tier-premium`), dark gold Enterprise panel, dashed Free strip | `landing.html:242-243,262-263` | Plans differ by content; the recommended plan gets the one filled button and a "Recommended" label |
| L10 | **Always-dark ground** with landing-only palette (`#0b0b0d`, `#f4f3f1`, `#ff5d52`) and no theme | `landing.html:74-90` | Shared tokens with the app (light and dark from `prefers-color-scheme`) |
| L11 | **Outward ↗ arrows on same-site CTAs** | `landing.html:611,733,811,838,841` | Plain labels; ↗ only for links that leave Cleo |
| L12 | **Capsule nav lockup** ("Cleo \| POS" in a capsule) | `landing.html:565-` | Glass nav bar (allowed: navigation) with the plain lockup |
| L13 | **Screen captures** (`#screen-data`, ~0.7 MB inline) taken from the old look | `landing.html:1653` | Re-capture from the rebuilt app with `tools/capture-screens.js` |

## 4. Admin console (`assets/admin/admin.css`)

The admin console already uses solid cards with a 1px line (`assets/admin/admin.css:162`) and has no grid, glow or grain. It moves to the shared tokens and the same sidebar/toolbar pattern; no gridbox removal is needed.

## 5. Unused CSS and assets after removal

To delete with the patterns above (verified by search before deletion in step 3):
- CSS: `.ambient*`, `.amb-*`, `.login-art.is-3d*`, `.sheen*`, `--grain-opacity`, `--rim-*`, `--accent-glow`, `--refract`, `.stage.framed`, `.stage-wrap`, `.plan-tab.t-*`, `.tier-*`, landing `.ground*`, `.grid-canvas`, `.grid-on *`, `.trace*`, `.port*`.
- JS: `Ripple`, `ambient`, `gridMark`, `emblem3d`, `LiquidGlass` (app); `Ripple`, `grid`, `traceField`, `marks`, `trace`, `markCols` (landing).
- Assets: none of `assets/` is used only by the grid (the emblem SVG stays). `tools/capture-screens.js` stays (re-capture).
- Docs: `DESIGN.md` sections "Materials (glass)", "Brand › Loading screen / Sign-in mark / Ripples", and "Landing extension: The lit grid" are replaced by `Docs/design/DESIGN_GUIDELINES.md`.

## 6. Done-when search (Phase 2 DONE WHEN: "a search finds no gridbox code")

```sh
grep -nE "amb-grid|\.ambient|gridMark|emblem3d|Ripple|LiquidGlass|--refract|feDisplacementMap|--grain|--rim-(edge|light|catch)|\.sheen|--accent-glow|grid-canvas|\.ground|\.trace|\.port\b|tier-(animated|premium|quiet)|t-elite|stage\.framed|inset 0 0 0 2px var\(--accent" index.html landing.html assets/admin/admin.css
```

Expected result after step 4: no matches (the landing's `#screen-data` line is regenerated from the rebuilt app, so it no longer carries the old CSS).
