# Audit after the redesign (Phase 2, step 6)

Re-audit of the rebuilt `landing.html` and `index.html` against [`AUDIT_BEFORE.md`](AUDIT_BEFORE.md) and the Phase 2 DONE WHEN. Run on 19 Nov 2026 on `cleo-overhaul/phase-2-frontend`, served locally by `tools/serve.js` with clean URLs on. The app was checked in its demo (sample business Kapé Lumen). Screenshots are in [`AFTER/`](AFTER/).

## DONE WHEN

| Criterion | Status | Evidence |
|---|---|---|
| A search finds no gridbox code and no visible `.html` links | **Met, with owner-directed exceptions** | See "Gridbox search" and "Visible `.html` links" below |
| Every old `.html` URL returns 301 on Hostinger staging | **Waiting on staging** | Verified locally ([`CLEAN_URLS.md`](CLEAN_URLS.md#checks-run-local-toolsservejs)); no staging subdomain exists yet |
| Every token text and background pair passes AA | **Met** (exemptions justified) | 128 pairs computed; see "Contrast" |
| Both pages render at 375, 768, 1024 and 1440 px, light and dark, with reduced transparency and reduced motion | **Met** | 54 captures in `AFTER/` plus 3 in forced colours; 0 overflow, 0 `.html` links, no exceptions (see "Screenshot run") |
| Auth flows still return to the right pages | **Met** (locally) | `node tools/check-auth-paths.mjs`: 18 of 18 pass; `/login`, `/signup` and `/plans` checked in the browser |
| The Impeccable re-audit findings are fixed or justified | **Met** | See "Detector" and "Open items" |

## Gridbox search

The search from [`GRIDBOX_REMOVAL.md` §6](GRIDBOX_REMOVAL.md) finds 18 lines, 9 in each page. Every match is either something the owner asked for after step 1, or data:

| Match | Where | Why it stays |
|---|---|---|
| `LiquidGlass`, `feDisplacementMap`, `--refract` | `index.html` (sign-in panes, glass surfaces), `landing.html` (glass capsule, hero panes) | Owner, 19 Nov: "make sure every liquid glass panel looks like real glass that refracts light" ([DESIGN_GUIDELINES §K](DESIGN_GUIDELINES.md)) |
| `Ripple` | `landing.html`, the last page's lit grid | Owner, 19 Nov: "for the last page of the landing page, use the original design (the fading gradient, the subtle gridbox animation, the original ripple effect, the Cleo logo lit up)" |
| `t-elite` | `landing.html`, `#plan-data` JSON | Plan data (the plan's tab name from `content/plans.md`), not a style |

The rest of the old patterns are gone, in both the app and the landing page's upper sections. That covers the ambient grid, the voxel emblem, grain, rim bevels, accent glows, trace, ports, tier looks, the framed Terminal stage and red selection rings.

## Visible `.html` links

- **Landing, legal pages and the 404 page:** none. Every capture's log records `htmlLinks=none`.
- **App:** the legal links follow the address the app was opened at. On the website they are `/privacy` and `/terms`; in the Windows and Android apps they stay `legal/*.html`, where no address bar shows them.
- **Fixed during this step:**
  - The legal reader's cross-links (commit `df7ca65`).
  - The admin console's "Back to Cleo" link and the return address of password resets it sends (commit `5ed3a44`).

## Contrast

Computed with the WCAG 2 formula from `styles/tokens.css`:

- **Pairs:** every text token on every surface, in light and dark. Translucent fills and glass are composited over the surface beneath.
- **Also checked:** semantic text on its own tint, `--on-accent` on the accent and its hover and pressed states, and receipt ink on paper.
- **Non-text:** control edges and the accent as a control colour, at 3:1.

**Fixed in this step** (commit `7f54277`):

| Token | Before → after | Weakest pair after |
|---|---|---|
| light `--label-2` | `#6e6e73` → `#6c6c71` | 4.54:1 on a fill over white |
| dark `--accent-text` | `#ff6b61` → `#ff786f` | 4.58:1 on a fill; 4.63:1 on its tint |
| dark `--destructive` | `#ff6961` → `#ff766f` | 4.53:1 on a fill |
| dark `--info` | `#409cff` → `#51a5ff` | 4.57:1 on a fill |

Landing text that carried information also moved off `--label-3`: the counter's fine print, the empty-order hint, the legal row and the comparison table's "not included" mark.

**Justified (9 pairs):**

- **`--label-3`, 8 pairs** (2.83–4.15:1). [DESIGN_GUIDELINES §A2](DESIGN_GUIDELINES.md) reserves it for disabled text and decorative glyphs, never information. WCAG exempts disabled text.
  - The app reaches it only through the `--ink-4` alias, in 12 places. All are decorative or state glyphs: empty-state icons, PIN-dot rings, idle status dots, the signal-strength bars and dashed chart links.
- **Dark `--accent` as a non-text colour on `--bg-elevated`** (2.84:1). The brand red `#d40000` fills buttons and badges that carry their own label, so WCAG 1.4.11 does not apply. State indicators use `--accent-text` (6.10:1) or `--switch-on`.

All 119 other pairs pass. The full table is at the end of this page.

## Detector

`impeccable detect` on `index.html`, `landing.html`, `admin/index.html`, `assets/admin/admin.css`, `styles/tokens.css`, `404.html` and `legal/*.html`. It reported 30 findings and 6 advisory notes, against 24 before.

| Finding | Count | Disposition |
|---|---|---|
| `skipped-heading` (landing: h1 → h3 at the figures; h2 → h4 "Payment mix") | 2 | **Fixed** (commit `5057228`): a hidden "Why Cleo" h2; "Payment mix" is an h3 |
| `cramped-padding` | 20 | **False positive.** Static reading of rules that later rules override (`.band` no longer has a border; `.features` columns have 24 px and their own padding at ≥ 900 px; the FAQ rows are 64 px tall) |
| `clipped-overflow-container` (html, body, main) | 3 | **Justified.** `overflow-x: clip` stops the off-edge product screens from causing a sideways scroll. No popover or menu sits inside these on the landing |
| `flat-type-hierarchy` | 1 | **False positive.** The detector cannot resolve `font: var(--t-hero)` and `clamp()`; rendered sizes measured in the browser at 1600 px wide: h1 84, h2 48, lede 19, h3 17, body 15, labels 11 px |
| `all-caps-body` (33 characters) | 1 | **Justified.** The receipt replicas (store header in uppercase, like a thermal print) and short section labels |
| `pulsing-dot` (`.spinner`) · `marquee` (`.sk` shimmer) | 2 | **Justified.** Owner direction: skeletons for loading, three dots for in-place waits ([DESIGN_GUIDELINES §K](DESIGN_GUIDELINES.md)); both stop under reduced motion |
| `dark-glow` (`#ff3b30`) | 1 | **Justified.** The barcode scanner's laser line, drawn as a laser |
| Advisory `thin-border-wide-shadow` | 6 | **Kept.** Floating cards over product screens (receipt, payment mix, transfer, counter, glass panes) need both an edge on busy screenshots and a lift |

## Screenshot run

**Method:** headless Edge through the DevTools protocol against `node tools/serve.js` (clean URLs on), the app in its demo. Viewports: 375×812 (mobile emulation), 768×1024, 1024×768 and 1440×900.

**What each capture records** (in [`AFTER/_log.txt`](AFTER/_log.txt)):

- whether the page scrolls sideways;
- any visible link ending in `.html`;
- console exceptions.

**Result:** 54 captures with **0 sideways overflow, 0 `.html` links and no exceptions**. Three forced-colours captures were added.

**Run notes:**

- The Terminal was re-captured in a second pass that registers the device first. The first pass stopped at "Register this terminal".
- Two earlier attempts were discarded: one because `.htaccess` was being rewritten while the app loaded, one because the preview server restarted.

| View | Files |
|---|---|
| Landing (follows the device theme) | `landing-{375,768,1024,1440}-{light,dark}.jpg` |
| Sign-in (`/login`) | `signin-{width}-{light,dark}.jpg` |
| Owner Dashboard (all branches) | `owner-{width}-{light,dark}.jpg` |
| Back Office overview | `backoffice-{width}-{light,dark}.jpg` |
| Terminal (sell screen, after PIN and opening the shift) | `terminal-{width}-{light,dark}.jpg` |
| Plans (`#/plans`) | `plans-{width}-{light,dark}.jpg` |
| Reduced motion and reduced transparency, together | `reduced-{landing,owner,terminal}-1024-{light,dark}.jpg` |
| Forced colours (Windows High Contrast) | `forced-colors-{landing,signin,owner}-1024.jpg` |

**Found and fixed during the run:**

- On phones, the landing's signal lines ran through the headline (commit `216e458`).
- The landing grid threw when the page loaded in a background tab (commit `2749bca`).
- In forced colours, checkboxes and chart bars disappeared (commit `8dc2c93`).

## Scores (same method as before)

**Design health** (Nielsen heuristics, Impeccable `critique`):

| # | Heuristic | App before → after | Landing before → after | What changed |
|---|---|---|---|---|
| 1 | Visibility of system status | 3 → 3 | 3 → 4 | Landing: numbered sections, and the counter and offline demo show their state live. App: skeletons and three-dot waits instead of the grid spinner |
| 2 | Match system / real world | 3 → 3 | 3 → 4 | The headline says what Cleo does ("…keeps selling when the internet doesn't"); the BIR receipt is the landing's signature |
| 3 | User control and freedom | 3 → 3 | 3 → 3 | Unchanged (no undo on "Order cleared": Phase 3) |
| 4 | Consistency and standards | 2 → 3 | 2 → 3 | One selection style (tinted fill and accent label); same-site links without ↗; one red primary per view |
| 5 | Error prevention | 3 → 3 | 3 → 3 | Quick tenders sorted |
| 6 | Recognition rather than recall | 3 → 3 | 3 → 3 | Unchanged |
| 7 | Flexibility and efficiency | 2 → 2 | n/a | No keyboard shortcuts added (Phase 3 usability work) |
| 8 | Aesthetic and minimalist design | 2 → 3 | 2 → 3 | The grid world is gone from the app; glass sits on chrome. The landing is richer by owner request (motion, backgrounds, interactive displays), so it is calm but busy |
| 9 | Error recovery | 3 → 3 | n/a | Unchanged |
| 10 | Help and documentation | 2 → 2 | 3 → 3 | No in-app help yet (Phase 3) |
| | **Total** | **26 → 28 / 40** | **22 → 26 / 32** | |

**Technical health** (Impeccable `audit`):

| # | Dimension | App before → after | Landing before → after | Evidence |
|---|---|---|---|---|
| 1 | Accessibility | 3 → 4 | 3 → 4 | Every information-carrying token pair is AA; forced colours handled (new); heading order fixed; reduced motion and reduced transparency equivalents; the counter is announced once per change |
| 2 | Performance | 2 → 2 | 2 → 3 | Landing HTML 896 KB → 163 KB; its two canvases run at about 30 fps and pause off-screen and in background tabs. App still one 1.41 MB file (was 1.47 MB) |
| 3 | Responsive | 2 → 3 | 3 → 4 | The Terminal fills the window (Charge 360×60 at 1280×800, 338×56 at 1024×768) instead of a fixed 2048×1280 stage. No horizontal overflow at any captured width. On phones the Terminal is still a scaled 1024×640 canvas |
| 4 | Theming | 3 → 4 | 3 → 4 | One `styles/tokens.css` for app, landing and admin (aliases for old names); landing 10 hex literals (receipt paper, chart series); app 131 (brand marks, wallet colours, receipt replicas) |
| 5 | Implementation integrity | 2 → 2 | 3 → 3 | The app still uses 543 `px` font sizes across 56 values, bypassing the type scale |
| | **Total** | **12 → 15 / 20** | **14 → 18 / 20** | |

## Open items (justified, with an owner)

| Item | Why it is not fixed in Phase 2 | Where it goes |
|---|---|---|
| App `px` font sizes (543 uses, 56 sizes) | A typeset pass across ~14,000 lines of screen code. It changes no behaviour and risks layout regressions on selling screens, which Phase 2 must not break | Step 4c (optional polish) or Phase 3 usability work |
| Terminal on phones is a scaled canvas | The Terminal's layout is built for the counter (at least 1024×640 logical); a phone layout is a new screen design | Phase 3 (Functions: device scope) |
| 301s on Apache | No Hostinger staging subdomain yet | When the owner creates staging (`curl -sI` table in `CLEAN_URLS.md`) |
| Supabase redirect URLs | Production is read-only for this overhaul | Owner, from the list in `CLEAN_URLS.md` |
| Keyboard shortcuts, in-app help, undo for "Order cleared" | Functional changes | Phase 3 |

## Full contrast table

`128 pairs, 9 below AA`. Computed from `styles/tokens.css` (commit after `7f54277`); translucent tokens composited over the surface beneath.

| Result | Theme | Text | On | Ratio | Needs |
|---|---|---|---|---|---|
| pass | light | `--label` | bg | 15.08:1 | 4.5 |
| pass | light | `--label` | bg-elevated | 16.83:1 | 4.5 |
| pass | light | `--label` | bg-raised | 16.83:1 | 4.5 |
| pass | light | `--label` | fill on elevated | 14.62:1 | 4.5 |
| pass | light | `--label` | glass-tint on bg | 15.96:1 | 4.5 |
| pass | light | `--label` | glass-solid | 16.01:1 | 4.5 |
| pass | light | `--label-2` | bg | 4.68:1 | 4.5 |
| pass | light | `--label-2` | bg-elevated | 5.22:1 | 4.5 |
| pass | light | `--label-2` | bg-raised | 5.22:1 | 4.5 |
| pass | light | `--label-2` | fill on elevated | 4.54:1 | 4.5 |
| pass | light | `--label-2` | glass-tint on bg | 4.95:1 | 4.5 |
| pass | light | `--label-2` | glass-solid | 4.97:1 | 4.5 |
| **below** (see above) | light | `--label-3` | bg | 2.92:1 | 4.5 |
| **below** (see above) | light | `--label-3` | bg-elevated | 3.26:1 | 4.5 |
| **below** (see above) | light | `--label-3` | bg-raised | 3.26:1 | 4.5 |
| **below** (see above) | light | `--label-3` | fill on elevated | 2.83:1 | 4.5 |
| **below** (see above) | light | `--label-3` | glass-tint on bg | 3.09:1 | 4.5 |
| **below** (see above) | light | `--label-3` | glass-solid | 3.10:1 | 4.5 |
| pass | light | `--accent-text` | bg | 4.95:1 | 4.5 |
| pass | light | `--accent-text` | bg-elevated | 5.53:1 | 4.5 |
| pass | light | `--accent-text` | bg-raised | 5.53:1 | 4.5 |
| pass | light | `--accent-text` | fill on elevated | 4.80:1 | 4.5 |
| pass | light | `--accent-text` | glass-tint on bg | 5.24:1 | 4.5 |
| pass | light | `--accent-text` | glass-solid | 5.26:1 | 4.5 |
| pass | light | `--success` | bg | 5.70:1 | 4.5 |
| pass | light | `--success` | bg-elevated | 6.36:1 | 4.5 |
| pass | light | `--success` | bg-raised | 6.36:1 | 4.5 |
| pass | light | `--success` | fill on elevated | 5.52:1 | 4.5 |
| pass | light | `--success` | glass-tint on bg | 6.03:1 | 4.5 |
| pass | light | `--success` | glass-solid | 6.04:1 | 4.5 |
| pass | light | `--warning` | bg | 5.76:1 | 4.5 |
| pass | light | `--warning` | bg-elevated | 6.43:1 | 4.5 |
| pass | light | `--warning` | bg-raised | 6.43:1 | 4.5 |
| pass | light | `--warning` | fill on elevated | 5.59:1 | 4.5 |
| pass | light | `--warning` | glass-tint on bg | 6.10:1 | 4.5 |
| pass | light | `--warning` | glass-solid | 6.12:1 | 4.5 |
| pass | light | `--destructive` | bg | 5.91:1 | 4.5 |
| pass | light | `--destructive` | bg-elevated | 6.59:1 | 4.5 |
| pass | light | `--destructive` | bg-raised | 6.59:1 | 4.5 |
| pass | light | `--destructive` | fill on elevated | 5.72:1 | 4.5 |
| pass | light | `--destructive` | glass-tint on bg | 6.25:1 | 4.5 |
| pass | light | `--destructive` | glass-solid | 6.27:1 | 4.5 |
| pass | light | `--info` | bg | 5.17:1 | 4.5 |
| pass | light | `--info` | bg-elevated | 5.77:1 | 4.5 |
| pass | light | `--info` | bg-raised | 5.77:1 | 4.5 |
| pass | light | `--info` | fill on elevated | 5.01:1 | 4.5 |
| pass | light | `--info` | glass-tint on bg | 5.47:1 | 4.5 |
| pass | light | `--info` | glass-solid | 5.49:1 | 4.5 |
| pass | light | `--glass-label` | glass-tint on bg | 15.96:1 | 4.5 |
| pass | light | `--glass-label-2` | glass-tint on bg | 10.76:1 | 4.5 |
| pass | light | `--accent-text` | accent-fill on elevated | 4.60:1 | 4.5 |
| pass | light | `--success` | success-fill on elevated | 5.47:1 | 4.5 |
| pass | light | `--warning` | warning-fill on elevated | 5.48:1 | 4.5 |
| pass | light | `--destructive` | destructive-fill on elevated | 5.63:1 | 4.5 |
| pass | light | `--info` | info-fill on elevated | 5.00:1 | 4.5 |
| pass | light | `--on-accent` | accent | 5.53:1 | 4.5 |
| pass | light | `--on-accent` | accent-hover | 6.75:1 | 4.5 |
| pass | light | `--on-accent` | accent-pressed | 8.42:1 | 4.5 |
| pass | light | `--paper-ink` | paper | 16.83:1 | 4.5 |
| pass | light | `--control-border` | bg-elevated (non-text) | 3.62:1 | 3 |
| pass | light | `--control-border` | bg (non-text) | 3.25:1 | 3 |
| pass | light | `--accent` | bg (non-text) | 4.95:1 | 3 |
| pass | light | `--accent` | bg-elevated (non-text) | 5.53:1 | 3 |
| pass | light | `--switch-on` | bg-elevated (non-text) | 4.40:1 | 3 |
| pass | dark | `--label` | bg | 16.60:1 | 4.5 |
| pass | dark | `--label` | bg-elevated | 14.39:1 | 4.5 |
| pass | dark | `--label` | bg-raised | 12.42:1 | 4.5 |
| pass | dark | `--label` | fill on elevated | 10.82:1 | 4.5 |
| pass | dark | `--label` | glass-tint on bg | 15.15:1 | 4.5 |
| pass | dark | `--label` | glass-solid | 14.39:1 | 4.5 |
| pass | dark | `--label-2` | bg | 7.03:1 | 4.5 |
| pass | dark | `--label-2` | bg-elevated | 6.09:1 | 4.5 |
| pass | dark | `--label-2` | bg-raised | 5.26:1 | 4.5 |
| pass | dark | `--label-2` | fill on elevated | 4.58:1 | 4.5 |
| pass | dark | `--label-2` | glass-tint on bg | 6.41:1 | 4.5 |
| pass | dark | `--label-2` | glass-solid | 6.09:1 | 4.5 |
| pass | dark | `--label-3` | bg | 5.54:1 | 4.5 |
| pass | dark | `--label-3` | bg-elevated | 4.81:1 | 4.5 |
| **below** (see above) | dark | `--label-3` | bg-raised | 4.15:1 | 4.5 |
| **below** (see above) | dark | `--label-3` | fill on elevated | 3.61:1 | 4.5 |
| pass | dark | `--label-3` | glass-tint on bg | 5.06:1 | 4.5 |
| pass | dark | `--label-3` | glass-solid | 4.81:1 | 4.5 |
| pass | dark | `--accent-text` | bg | 7.03:1 | 4.5 |
| pass | dark | `--accent-text` | bg-elevated | 6.10:1 | 4.5 |
| pass | dark | `--accent-text` | bg-raised | 5.26:1 | 4.5 |
| pass | dark | `--accent-text` | fill on elevated | 4.58:1 | 4.5 |
| pass | dark | `--accent-text` | glass-tint on bg | 6.42:1 | 4.5 |
| pass | dark | `--accent-text` | glass-solid | 6.10:1 | 4.5 |
| pass | dark | `--success` | bg | 8.94:1 | 4.5 |
| pass | dark | `--success` | bg-elevated | 7.75:1 | 4.5 |
| pass | dark | `--success` | bg-raised | 6.69:1 | 4.5 |
| pass | dark | `--success` | fill on elevated | 5.82:1 | 4.5 |
| pass | dark | `--success` | glass-tint on bg | 8.16:1 | 4.5 |
| pass | dark | `--success` | glass-solid | 7.75:1 | 4.5 |
| pass | dark | `--warning` | bg | 8.79:1 | 4.5 |
| pass | dark | `--warning` | bg-elevated | 7.62:1 | 4.5 |
| pass | dark | `--warning` | bg-raised | 6.58:1 | 4.5 |
| pass | dark | `--warning` | fill on elevated | 5.73:1 | 4.5 |
| pass | dark | `--warning` | glass-tint on bg | 8.03:1 | 4.5 |
| pass | dark | `--warning` | glass-solid | 7.62:1 | 4.5 |
| pass | dark | `--destructive` | bg | 6.95:1 | 4.5 |
| pass | dark | `--destructive` | bg-elevated | 6.03:1 | 4.5 |
| pass | dark | `--destructive` | bg-raised | 5.20:1 | 4.5 |
| pass | dark | `--destructive` | fill on elevated | 4.53:1 | 4.5 |
| pass | dark | `--destructive` | glass-tint on bg | 6.34:1 | 4.5 |
| pass | dark | `--destructive` | glass-solid | 6.03:1 | 4.5 |
| pass | dark | `--info` | bg | 7.04:1 | 4.5 |
| pass | dark | `--info` | bg-elevated | 6.10:1 | 4.5 |
| pass | dark | `--info` | bg-raised | 5.26:1 | 4.5 |
| pass | dark | `--info` | fill on elevated | 4.58:1 | 4.5 |
| pass | dark | `--info` | glass-tint on bg | 6.42:1 | 4.5 |
| pass | dark | `--info` | glass-solid | 6.10:1 | 4.5 |
| pass | dark | `--glass-label` | glass-tint on bg | 15.15:1 | 4.5 |
| pass | dark | `--glass-label-2` | glass-tint on bg | 10.84:1 | 4.5 |
| pass | dark | `--accent-text` | accent-fill on elevated | 4.64:1 | 4.5 |
| pass | dark | `--success` | success-fill on elevated | 5.69:1 | 4.5 |
| pass | dark | `--warning` | warning-fill on elevated | 5.59:1 | 4.5 |
| pass | dark | `--destructive` | destructive-fill on elevated | 5.03:1 | 4.5 |
| pass | dark | `--info` | info-fill on elevated | 4.59:1 | 4.5 |
| pass | dark | `--on-accent` | accent | 5.53:1 | 4.5 |
| pass | dark | `--on-accent` | accent-hover | 4.91:1 | 4.5 |
| pass | dark | `--on-accent` | accent-pressed | 7.38:1 | 4.5 |
| pass | dark | `--paper-ink` | paper | 16.83:1 | 4.5 |
| pass | dark | `--control-border` | bg-elevated (non-text) | 3.77:1 | 3 |
| pass | dark | `--control-border` | bg (non-text) | 4.35:1 | 3 |
| pass | dark | `--accent` | bg (non-text) | 3.27:1 | 3 |
| **below** (see above) | dark | `--accent` | bg-elevated (non-text) | 2.84:1 | 3 |
| pass | dark | `--switch-on` | bg-elevated (non-text) | 7.75:1 | 3 |
