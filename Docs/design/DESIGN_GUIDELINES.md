# Cleo Design Guidelines

**Status:** v1, Phase 2 of the overhaul (19 Nov 2026). Replaces the "gridbox" look recorded in [`GRIDBOX_REMOVAL.md`](GRIDBOX_REMOVAL.md) and supersedes the visual sections of the root `DESIGN.md`.
**Scope:** every Cleo surface — Terminal (iPadOS), Owner Dashboard, Back Office and admin console (macOS), phone widths (iOS), the landing page (Apple product-page style).
**Stack:** the current one — vanilla HTML/CSS/JS, one token stylesheet, no UI framework. Tokens are CSS custom properties; components use tokens only (no hard-coded colours, radii or durations).
**Fonts:** unchanged — Cleo Sans (Helvetica Neue 300/400/500/700 from `assets/fonts/`), the receipt monospace stack, Phosphor icons.

**Owner decisions this document follows** (`Docs/PROGRESS.md`, 19 Nov 2026): the signature is **the real product** shown large; **plans differ by content only**; the Owner Dashboard keeps the Activity heatmap and receipt trivia, restyled; the **Terminal follows the device** appearance.

**Owner direction, 19 Nov 2026 (later the same day) — takes precedence where it differs below:** use **Liquid Glass throughout the system** (panels and cards included, not only navigation and overlays), **rounded rectangles heavily** (larger radii everywhere), **rounded ends in every chart**, and **subtle interactive motion on the sign-in page**. The **Aeso logo** appears alone (no "Built by" / "Made by"), in the text colour: white on dark, near-black on light.

**Learned from (never copied):** apple.com and claude.com — restraint, generous spacing, a clear type hierarchy, product-first imagery, calm motion. No Apple or Anthropic assets, logos, icons or copy are used.

---

## A. Foundations

### A1. Type scale (Cleo Sans)

Cleo Sans has four weights: **300 Light, 400 Regular, 500 Medium, 700 Bold**. Apple's "semibold" maps to **500**; "bold" to **700**. Light (300) is used only for large figures (totals, prices ≥ 28 px). Tracking tightens as size grows; leading tightens as size grows.

Two densities share one scale:
- **Comfortable** — Terminal, phones, landing body, any coarse pointer. Body 17 px.
- **Compact** — Owner Dashboard, Back Office, admin on a fine pointer. Body 15 px.

| Token | Role | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--type-display` | Display (landing hero) | `clamp(44px, 6.4vw, 88px)` / 1.04 | 700 | −0.035em | One per page |
| `--type-display-2` | Display 2 (landing sections) | `clamp(34px, 4.4vw, 56px)` / 1.08 | 700 | −0.03em | Section headlines |
| `--type-large-title` | Large Title | 34 / 41 | 700 | −0.022em | Screen titles (Terminal, phone, dashboard greeting) |
| `--type-title-1` | Title 1 | 28 / 34 | 700 | −0.02em | Sheet titles, page titles (compact) |
| `--type-title-2` | Title 2 | 22 / 28 | 700 | −0.016em | Card titles, section heads |
| `--type-title-3` | Title 3 | 20 / 25 | 500 | −0.012em | Group heads, dialog titles |
| `--type-headline` | Headline | 17 / 22 | 500 | −0.006em | Emphasised rows, button labels (comfortable) |
| `--type-body` | Body | 17 / 24 (comfortable) · 15 / 21 (compact) | 400 | 0 | Running text, list rows |
| `--type-callout` | Callout | 16 / 21 | 400 | 0 | Secondary text in rows, button labels (compact: 15/20, 500) |
| `--type-subhead` | Subheadline | 15 / 20 | 400 | 0 | Table cells (compact), meta |
| `--type-footnote` | Footnote | 13 / 18 | 400 | +0.003em | Captions, helper text |
| `--type-caption` | Caption | 12 / 16 | 400 | +0.008em | Table column heads, timestamps (never below 12 px) |
| `--type-figure-xl` | Figure XL | 56 / 1 | 300 | −0.035em | Charge total, KPI hero number |
| `--type-figure-l` | Figure L | 34 / 1.05 | 300 | −0.025em | KPI numbers, prices |

Rules:
- Sizes are set in `rem` (base 16 px) so OS and browser text scaling reflows layouts.
- `text-wrap: balance` on headings; `text-wrap: pretty` on paragraphs. Headlines wrap at a deliberate point (max 3 lines; measure 12–22 em for display, 60–75 ch for body).
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every price, total, quantity, time, date, invoice number and table column of numbers — class `.num` or token `--numeric`.
- **Monospace only where needed:** receipts, e-journal, invoice and machine numbers (MIN, PTU, serial), backup codes. Never for decoration or "techy" labels.
- No italics except quoted names; no all-caps except BIR document headers on receipts.
- **On glass**, text uses `--glass-label` / `--glass-label-2` and weight ≥ 500 below 17 px (vibrancy rule, section B).

### A2. Colour

One accent (Cleo red), neutral greys, four semantic colours. Light and dark are full sets; the app follows `prefers-color-scheme` unless the person picks Light or Dark in Settings (`data-theme`). Contrast figures are WCAG ratios computed for these exact values (see section A2.4).

**A2.1 Neutrals**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f2f2f7` | `#000000` | Grouped background (page, behind cards) |
| `--bg-elevated` | `#ffffff` | `#1c1c1e` | Cards, solid content surfaces, sheets' content |
| `--bg-raised` | `#ffffff` | `#2c2c2e` | Popovers, menus (solid fallback), alerts |
| `--fill` | `rgb(120 120 128 / .12)` | `rgb(120 120 128 / .24)` | Segmented track, search field, quiet button |
| `--fill-strong` | `rgb(120 120 128 / .20)` | `rgb(120 120 128 / .36)` | Pressed quiet button, switch off track |
| `--label` | `#1d1d1f` | `#f5f5f7` | Primary text and icons |
| `--label-2` | `#6e6e73` | `#a1a1a6` | Secondary text, placeholders |
| `--label-3` | `#8e8e93` | `#8e8e93` | Disabled text, decorative glyphs only (never information) |
| `--separator` | `rgb(60 60 67 / .18)` | `rgb(84 84 88 / .55)` | Hairlines between rows and groups (decorative) |
| `--control-border` | `#86868b` | `#7c7c80` | Field edges, checkbox and radio rings, idle status dots (UI ≥ 3:1) |

**A2.2 Accent — Cleo red** (derived from the brand `#d40000`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#d40000` | `#d40000` | Filled primary button, selected sidebar/tab icon, checked checkbox and radio, focus ring |
| `--accent-hover` | `#bb0000` | `#e01414` | Hover on primary (fine pointer only) |
| `--accent-pressed` | `#a00000` | `#b00000` | Pressed primary |
| `--accent-text` | `#d40000` | `#ff6b61` | Links, plain-button labels, selected list checkmarks |
| `--accent-fill` | `rgb(212 0 0 / .10)` | `rgb(255 107 97 / .18)` | Selected chip / option background (with a checkmark) |
| `--on-accent` | `#ffffff` | `#ffffff` | Text and icons on `--accent` |

Red marks **one** primary action per view, the current selection, links, and the recommended plan's button. It never fills large areas, never glows, and never marks status (status uses the semantic colours). A business may replace the accent with its brand colour; `applyBrand` must keep `--on-accent` ≥ 4.5:1 and `--accent-text` ≥ 4.5:1 on `--bg-elevated`.

**A2.3 Semantic**

| Token | Light (text / fill) | Dark (text / fill) | Use |
|---|---|---|---|
| `--success` | `#0a6e3a` / `rgb(36 138 61 / .12)` | `#30d158` / `rgb(48 209 88 / .16)` | Synced, paid, in stock, switch on (`--switch-on`: light `#248a3d`, dark `#30d158`) |
| `--warning` | `#855400` / `rgb(154 98 0 / .12)` | `#ff9f0a` / `rgb(255 159 10 / .16)` | Low stock, degraded connection, nearing limits |
| `--destructive` | `#b3241d` / `rgb(198 42 34 / .10)` | `#ff6961` / `rgb(255 69 58 / .16)` | Void, remove, failed, offline errors |
| `--info` | `#1f63c4` / `rgb(31 99 196 / .10)` | `#409cff` / `rgb(64 156 255 / .18)` | Neutral notices, links inside notices |

Status is never colour alone: every status pairs colour with an icon or a word ("Low · 3 left", not an amber box).

**A2.4 Contrast (AA) — verified pairs**

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--label` on `--bg` / `--bg-elevated` / `--bg-raised` | 15.08 / 16.83 / 16.83 | 19.29 / 15.63 / 12.80 | 4.5 |
| `--label-2` on `--bg` / `--bg-elevated` / `--bg-raised` | 4.54 / 5.07 / 5.07 | 8.16 / 6.61 / 5.42 | 4.5 |
| `--accent-text` on `--bg` / `--bg-elevated` / `--bg-raised` | 4.95 / 5.53 / 5.53 | 7.53 / 6.10 / 5.00 | 4.5 |
| `--on-accent` on `--accent` / hover / pressed | 5.53 / 6.75 / 8.42 | 5.53 / — / — | 4.5 |
| `--accent` as a UI boundary on `--bg-elevated` | 5.53 | 3.08 | 3.0 |
| `--control-border` on `--bg` / `--bg-elevated` / `--bg-raised` | 3.25 / 3.62 / 3.62 | 5.05 / 4.09 / 3.35 | 3.0 |
| `--success` / `--warning` / `--destructive` / `--info` text on `--bg-elevated` | 6.36 / 6.43 / 6.59 / 5.77 | 8.42 / 8.28 / ≥ 4.9 / 6.01 | 4.5 |
| `--switch-on` vs `--bg-elevated` | 4.40 | 8.42 | 3.0 |
| White check on success badge fill `#1f7a35` | 5.39 | 5.39 | 3.0 |

`--label-3` (2.92–3.26 light) is **not** used for information; disabled text is exempt. Placeholders use `--label-2`. Text on glass: section B.

### A3. Spacing (4/8 pt)

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 · `--space-10` 40 · `--space-12` 48 · `--space-16` 64 · `--space-20` 80 · `--space-24` 96 · `--space-32` 128.

- **Group with spacing, not boxes.** Related items sit 8–12 apart; groups 24–32; sections 48–64 (app) and 96–128 (landing). A border or card is added only when a surface must read as one object (a sheet, a receipt, a table).
- Page gutters: 16 (phones), 24 (tablets), 32 (desktop app), `clamp(16px, 5vw, 64px)` (landing). Inset grouped lists inset 16 (iOS) / 20 (macOS).
- Row heights: 44 minimum; 52 for comfortable list rows; 36 for compact table rows (fine pointer only).

### A4. Shape — concentric radii

`--radius-xs` 8 · `--radius-sm` 12 · `--radius-md` 18 · `--radius-lg` 26 · `--radius-xl` 34 · `--radius-pill` 999 (raised 19 Nov per owner direction: rounded rectangles everywhere).

**Inner radius = outer radius − padding** (never below `--radius-xs`): a 20 px card with 8 px padding holds 12 px items; a 28 px sheet with 16 px padding holds 12 px fields; a pill holds pills. Buttons: pill (comfortable) or `--radius-sm` (compact toolbar buttons). Fields: `--radius-sm`. Cards: `--radius-lg`. Sheets and dialogs: `--radius-xl` (top corners only for bottom sheets on phones). Product tiles: `--radius-md`.

### A5. Light and depth — one light source from above

Light comes from directly above, so shadows fall straight down and grow softer with height; glass catches the light on its **top** edge only. Three elevations, no others:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-1` | `0 1px 2px rgb(0 0 0 / .06), 0 1px 1px rgb(0 0 0 / .04)` | `0 1px 2px rgb(0 0 0 / .5)` | Resting cards that sit on `--bg` (optional; prefer none) |
| `--shadow-2` | `0 8px 24px -6px rgb(0 0 0 / .16), 0 2px 6px rgb(0 0 0 / .06)` | `0 8px 24px -6px rgb(0 0 0 / .6), 0 2px 6px rgb(0 0 0 / .4)` | Popovers, menus, toasts, floating cart summary |
| `--shadow-3` | `0 24px 60px -12px rgb(0 0 0 / .24), 0 4px 12px rgb(0 0 0 / .08)` | `0 24px 60px -12px rgb(0 0 0 / .7)` | Sheets, dialogs, alerts |

No coloured shadows, no glows, no inner bevels on content, no grain.

### A6. Icons

One set: **Phosphor 2.1.1, Regular weight** (1.5 stroke look) for every UI icon; **Fill** only for a selected tab/sidebar item and for status glyphs inside 16 px badges. Bold is retired. Sizes: 16 (inline with footnote), 20 (rows, compact toolbar), 24 (tab bar, terminal rail, comfortable buttons), 28 (empty states). Icons inherit `currentColor`; no tinted icon squares. Brand marks (Google, GCash, Maya) keep their official artwork.

---

## B. Liquid Glass

Glass is Cleo's core material. **Owner direction (19 Nov): Liquid Glass throughout** — navigation, overlays, and also panels and cards (`.glass-thick`). A still, soft **wallpaper** (`--wallpaper`: three blurred washes of Cleo red, blue and green on `--bg`, no motion, no pattern) sits behind everything so the glass has something to frost. Dense reading surfaces inside glass — table rows, receipts, form fields — keep solid fills so text stays AA. The original rule (glass only on navigation and overlays) is kept below for reference.

### B1. Tokens

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--glass-tint` | `rgb(252 252 254 / .66)` | `rgb(36 36 40 / .62)` | Base fill |
| `--glass-tint-thick` | `rgb(252 252 254 / .78)` | `rgb(30 30 34 / .74)` | Panels, cards, sidebars and sheets (bigger surfaces read thicker) |
| `--glass-sheen` | white 55% → 0 over the top 62% | white 10% → 0 | Top-lit sheen layered over the tint (light from above) |
| `--glass-blur` | `24px` | `24px` | `backdrop-filter: blur()` |
| `--glass-blur-thick` | `40px` | `40px` | Sidebars, sheets |
| `--glass-saturation` | `180%` | `160%` | `saturate()` in the same filter |
| `--glass-border` | `rgb(0 0 0 / .08)` | `rgb(255 255 255 / .10)` | 1 px hairline around the surface |
| `--glass-specular` | `rgb(255 255 255 / .85)` | `rgb(255 255 255 / .14)` | 1 px inset highlight on the **top** edge only (`inset 0 1px 0`) |
| `--glass-shadow` | `--shadow-2` | `--shadow-2` | Floating bars; sheets use `--shadow-3` |
| `--glass-label` | `#1d1d1f` | `#f5f5f7` | Text on glass |
| `--glass-label-2` | `#3a3a3c` | `#d1d1d6` | Secondary text on glass (≥ 5:1 at the worst-case backdrop) |
| `--glass-solid` | `#f9f9fb` | `#1c1c1e` | Fallback fill when glass is off |
| `--scrim` | `rgb(0 0 0 / .20)` | `rgb(0 0 0 / .48)` | Dims content behind sheets and dialogs |

Recipe: `background: var(--glass-tint); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); border: 1px solid var(--glass-border); box-shadow: inset 0 1px 0 var(--glass-specular), var(--glass-shadow);`. No SVG displacement/refraction maps, no sheen gradients, no rim bevels.

### B2. Where glass goes — and where it never goes

| Glass (allowed) | Solid (always) |
|---|---|
| Tab bar (phones, Terminal rail) | Tables and data grids |
| Toolbar / top bar (unified, macOS) | Receipts, invoices, e-journal, Z/X-readings |
| Sidebar (macOS, iPadOS) | Forms and settings content |
| Sheets and dialogs (the panel; content inside is solid rows) | Reports, charts, KPI groups |
| Popovers, menus, context menus | Product grid and product lists |
| Floating cart summary / checkout bar on phones | Cards on the dashboard |
| Landing sticky navigation bar; landing dialogs | Landing sections, pricing cards |

### B3. Rules

- **At most two blurred layers in view** (e.g. toolbar + sheet). A popover over a sheet uses `--bg-raised` (solid) instead.
- **Never blur large scrolling areas** and never put glass on a surface wider than the viewport's content column except bars. Blur is applied to fixed/sticky bars and overlays only.
- **Never stack light glass on light glass**; chips and buttons on glass are `--fill` (no blur).
- **Scroll edge, not divider:** where content scrolls under a glass bar, the bar's bottom hairline appears only after scrolling starts (`[data-scrolled]`).
- **Vibrancy:** text on glass uses `--glass-label*`, weight ≥ 500 under 17 px; icons on glass use `--glass-label`.
- **Materialize, don't just fade:** sheets and popovers enter with opacity + scale (0.96 → 1) together; blur is not animated (cost).

### B4. Required fallbacks

```css
@media (prefers-reduced-transparency: reduce) { .glass { background: var(--glass-solid); backdrop-filter: none; } }
@media (prefers-contrast: more) { .glass { background: var(--glass-solid); backdrop-filter: none; border-color: var(--control-border); } }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .glass { background: var(--glass-solid); } }
@media (forced-colors: active) { .glass { background: Canvas; border: 1px solid CanvasText; backdrop-filter: none; box-shadow: none; } }
```

Reduced motion is handled in section C.

---

## C. Motion

Motion answers a touch, a change of screen or a change of state, then stops. Only `transform` and `opacity` animate; nothing shifts layout. Nothing loops in working chrome.

**Tokens**

| Token | Value | Use |
|---|---|---|
| `--dur-micro` | 140ms | Press, hover, toggle, checkmark (range 120–180) |
| `--dur-short` | 220ms | Popovers, menus, toasts, list insertions |
| `--dur-medium` | 280ms | Sheets, dialogs, screen changes (range 200–300) |
| `--dur-max` | 360ms | The ceiling for anything (never over 400) |
| `--ease-out` | `cubic-bezier(.32, .72, 0, 1)` | Entering (fast start, gentle settle) |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | Exiting |
| `--ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` | Moving between two on-screen positions |
| `--ease-spring` | `linear(0, .006, .025 2.8%, .101 6.1%, .539 18.9%, .721 25.3%, .849 31.5%, .937 38.1%, .968 41.8%, .991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.6%, 1)` | Light spring settle (~1.7% overshoot); use with `--dur-medium` |

**The twelve principles as Cleo rules**

| Principle | Cleo rule | Duration / easing | Example |
|---|---|---|---|
| Squash and stretch | Pressable surfaces scale to **0.97** on pointer-down (instantly, not on release) and spring back on release | down: `--dur-micro` `--ease-out`; up: `--dur-medium` `--ease-spring` | Charge button, product tile, keypad key |
| Anticipation | Sheets make a 4 px counter-move (down) before rising; drag handles respond on touch-down (handle widens 2 px) | 80ms then `--dur-medium` `--ease-out` | Payment sheet opening; grabbing the sheet handle |
| Staging | Dim the background with `--scrim` behind sheets and dialogs; the background does not move | `--dur-short` `--ease-out` | Void dialog, options sheet |
| Pose to pose | Every animated element has a defined start and end state in CSS (`@starting-style` or a class pair); no mid-state is ever left on screen | — | Toast: `translateY(8px) opacity 0` → `0, 1` |
| Follow through | Settling uses `--ease-spring` (one light overshoot), never a bounce series | `--dur-medium` | Sheet reaching its detent; switch knob |
| Slow in, slow out | Ease-in-out to move, ease-out to enter, ease-in to exit (exits 20% faster than entrances) | enter `--dur-medium`, exit 220ms | Screen change: incoming fades/slides 8 px in, outgoing fades out |
| Arcs | An added item flies to the cart on a curve (two transforms: X linear, Y `--ease-out`) and shrinks to 0.4; only when the cart is visible and reduced motion is off | `--dur-medium` | Tapping a product tile on the Sell screen |
| Secondary action | The cart badge bumps (scale 1 → 1.12 → 1) when the flying item lands | `--dur-short` `--ease-spring` | Cart count after adding |
| Timing | Micro 120–180 ms; transitions 200–300 ms; nothing over 400 ms; no delays on the input path | tokens above | Hover never delays; tooltips appear after 500 ms (not motion) |
| Exaggeration (feedback) | Invalid input: a 3-cycle horizontal shake of 6 px; success: a brief check that scales 0.8 → 1 and holds 900 ms before the next state | shake 300ms total; check `--dur-short` `--ease-spring` | Wrong PIN; "Payment complete" |
| Solid drawing (3D) | Consistent light from above: shadows only downward, glass highlight only on the top edge, pressed surfaces lose `--shadow-1` | — | All elevations in A5 |
| Appeal | Calm and premium: remove any motion that does not explain a change. No ambient animation, no parallax, no scroll-jacking, no looping glows | — | The landing has no animated background |

**Reduced motion** (`prefers-reduced-motion: reduce`): replace movement with opacity cross-fades of `--dur-short`; remove the fly-to-cart arc, shake (use the error colour and message instead), counter-moves and springs; keep state changes (checkmarks, colour changes) so feedback survives. Never set every duration to 0.

---

## D. UX laws (measurable rules)

| Law | Rule | Measure / check |
|---|---|---|
| **Fitts's law** | Every target ≥ **44 × 44 pt** on every surface; primary POS actions (Charge, Add, Pay, Complete payment, Open shift) ≥ **56 px** tall and full-width or in the bottom 40% of a tablet screen (thumb reach), never in a corner | Measure rendered boxes at 1280×800 and 1024×768 (no scaling of the Terminal) |
| **Hick's law** | One primary (filled) action per view; 5–7 top-level navigation items at most; anything beyond goes under "More" or into Settings; choices > 7 are grouped or searchable | Count filled buttons per screen (= 1); count sidebar/tab items (≤ 7) |
| **Doherty threshold** | Acknowledge every input within **100 ms** (pressed state on pointer-down); show a loading state (spinner in the button, or a skeleton) if anything takes **> 400 ms**; Supabase writes that are safe to retry show optimistically (e.g. saving a setting) and roll back with a message on failure; selling screens never wait on the network | Performance panel: input → paint < 100 ms; every async action has a loading state |
| **Postel's law** | Accept money as typed — "₱1,000", "1000", "1,000.00", "1 000", "P1000" — and normalise to integer centavos; accept phone numbers with spaces or +63; output is always strict: `₱1,000.00`, tabular | Unit tests on the money parser for each format |
| **Jakob's law** | Use Apple and mainstream POS conventions: tab bar, sidebar, sheets, segmented controls, swipe-to-delete with confirm, numeric keypad layout 1-2-3 on top; no novel controls for standard tasks | Review: every control maps to a component in section F |
| **Frequency of use** | The most frequent actions are biggest and closest (Sell screen: products, cart, Charge); rare actions (End of day, Add clerk, Switch mode, device settings) live in menus, never as primary buttons | Terminal: Charge is the largest target; End of day ≤ 1 tap deep in More |

---

## E. Refinement rules

| # | Rule | Do | Don't |
|---|---|---|---|
| 1 | Delete filler badges | "Basic" plan name alone | "NEW", "BETA", "★ Popular" chips on every card |
| 2 | Drop redundant labels | A ₱ figure under "Net sales" | "Net sales amount: ₱145,010 (net sales)" |
| 3 | Unitalicize random words | "Sell even when the internet is down." | "Sell *even* when the internet is *down*." |
| 4 | Mono only where needed | Invoice `00001234`, MIN, receipts in mono | Section labels or prices in mono to look technical |
| 5 | Use an Apple-based system | iOS switch, segmented control, inset grouped list | Custom toggles and neon tabs |
| 6 | Show the actual product | A large real Terminal screen in the landing hero | Abstract grids, stock photos, illustrations of "data" |
| 7 | Enlarge the main feature | Charge button 56+ px, total in Figure XL | Total the same size as the line items |
| 8 | Group with spacing | 24 px between groups, hairlines between rows | A bordered box around every group |
| 9 | Make headlines specific | "The point of sale that keeps selling offline." | "One Phase Ahead." |
| 10 | Emphasise the CTA | One filled red "Get started"; others plain | Three equal outlined buttons |
| 11 | Add an accent colour | Cleo red on the one primary action and selection | Red on charts, badges, borders and icons at once |
| 12 | Keep icons consistent | Phosphor Regular, 20/24 px, `currentColor` | Mixing Regular, Bold and Fill in one toolbar |
| 13 | Remove embellishments | Solid card, hairline separators | Glows, grain, gradients, rim bevels, ports, traces |
| 14 | Inner radius = outer − padding | 20 px card, 8 px padding, 12 px tile | 20 px tile inside a 20 px card |
| 15 | Improve text contrast | `--label-2` (≥ 4.5:1) for secondary text | 34% white for status, PIN dots or placeholders |
| 16 | Wrap headlines properly | `text-wrap: balance`, break after a phrase | One orphan word on line two |
| 17 | Align by eye, not by pixels | Optically centre the ₱ and play icons; nudge round glyphs | Trusting the box model for icon-plus-text alignment |
| 18 | Use tabular numbers | Totals that don't jitter as they count | Proportional digits in a column of prices |
| 19 | Add the loading states | Spinner inside "Complete payment", skeleton rows | A frozen button for 2 seconds |
| 20 | Animate useful feedback | Checkmark on success, shake on wrong PIN | Ambient ripples, looping shimmer on idle chrome |

---

## F. Components

Every component has these states unless noted: **default · hover** (fine pointer only, never required to discover anything) **· pressed** (on pointer-down, scale 0.97 for surfaces, `--accent-pressed`/`--fill-strong` for colours) **· focus-visible** (2 px `--accent` outline, 2 px offset, plus `outline: 2px solid transparent` fallback so forced colours paint it) **· disabled** (`--label-3` text, no shadow, `cursor: not-allowed`, still ≥ 44 pt) **· loading** (label stays, a 16 px spinner replaces the leading icon, width does not change, `aria-busy="true"`).

| Component | Anatomy | Sizes | Tokens / notes |
|---|---|---|---|
| **Button — primary** | Label (Headline/Callout 500), optional leading icon | L 56 (POS actions), M 44, S 36 (compact toolbars, fine pointer only) | `--accent`, `--on-accent`, `--radius-pill` (comfortable) / `--radius-sm` (compact), `--shadow-1` none on press. One per view |
| **Button — secondary** | Same | Same | `--fill` background, `--label` text |
| **Button — plain** | Label only, optional icon | Same min target | `--accent-text`, no background; hover `--fill` |
| **Button — destructive** | Label, optional trash/× icon | Same | Plain style in `--destructive`; filled `--destructive` only inside a confirmation alert. Always confirms (or offers undo) |
| **Input / text field** | Label above, field, helper or error below | 44 (compact), 52 (comfortable) | `--bg-elevated` fill, 1 px `--control-border`, `--radius-sm`; focus: 2 px `--accent` ring; error: `--destructive` border + message with icon; 17 px text on touch (no iOS zoom) |
| **Money field** | ₱ prefix, tabular value, keypad on Terminal | 56 on Terminal | Accepts the Postel formats (D); shows strict format on blur |
| **Segmented control** | Track + sliding thumb + 2–5 labels | 32 (compact), 44 (comfortable) | Track `--fill`, thumb `--bg-elevated` + `--shadow-1`, thumb slides `--dur-medium` `--ease-spring` |
| **Switch** | Track 51 × 31, knob 27 | One size | Off `--fill-strong`, on `--switch-on`; knob stretches on press |
| **Checkbox / radio** | Box/circle + label | 22 glyph in a 44 target | `--control-border` ring; checked `--accent` fill with white check |
| **Tab bar** (phones, Terminal rail) | 3–5 items: icon (Fill when selected) + label | 49 + safe area (phones); rail 88 wide (Terminal) | Glass; selected `--accent-text`; unselected `--glass-label-2` |
| **Sidebar** (macOS / iPadOS) | Header (lockup), sections of rows (icon + label + count), footer (account) | 240–280 wide, full height, flush to the window edge | Glass thick; selected row `--fill` with Fill icon in `--accent-text`; counts `--label-2`; max 7 top-level rows per section |
| **Toolbar** (unified, macOS) | Title (Title 3), centre segmented control or search, trailing actions (max 3 + "More") | 52 tall | Glass; hairline appears on scroll; one primary at most |
| **Sheet** | Grabber (phones), title row (Cancel · Title · Done), solid content | Detents: medium (50%), large (92%); centred dialog sheet on ≥ 768 px, max 560 wide | Glass thick panel, `--radius-xl`, `--shadow-3`, `--scrim`; enter `--dur-medium` `--ease-out` with 4 px anticipation; exit `--ease-in` 220 ms; Esc and swipe-down close; focus trapped and restored |
| **Popover / menu** | Arrow-less panel anchored to its trigger, rows 44 | Min 200 wide | Glass (or `--bg-raised` when over a sheet); `transform-origin` at the trigger; `--dur-short` |
| **Alert** | Title (Headline), message (Footnote), 1–2 buttons (Cancel left/plain, action right) | Max 320 wide | `--bg-raised`, `--radius-lg`, `--shadow-3`, `--scrim`; destructive action filled `--destructive` here only |
| **Toast** | Icon + one-line message + optional action ("Undo") | Max 420 wide, bottom centre (above tab bar) | `--bg-raised` solid, `--shadow-2`; `role="status"`; 4 s, paused on hover/focus |
| **Table** | Sticky header (Caption 500, `--label-2`), rows, optional footer totals | Row 36 (compact) / 52 (touch) | Solid `--bg-elevated`; hairline row separators; numeric columns right-aligned, tabular; no zebra; row hover `--fill` |
| **List row** (inset grouped) | Leading icon (20) · title · subtitle · trailing value / chevron / switch | 44 min, 52 comfortable | Groups on `--bg-elevated`, `--radius-lg`, inset separators starting after the icon |
| **Empty state** | Icon 28 (`--label-3`), title (Title 3), one sentence, one action | Centred in the content area | No illustrations of grids; the action is the view's one primary |
| **Skeleton** | Rounded bars matching the final layout | — | `--fill`; a single 1.2 s opacity pulse (0.6 → 1) instead of a sliding shimmer; static under reduced motion |
| **Badge / count** | Number or short word | 20 tall, pill | Counts `--fill` + `--label`; status badges use semantic fill + text (never colour alone) |
| **Product tile** (Terminal) | Name (Headline), price (tabular, `--label-2`), stock note when low ("3 left" in `--warning` with icon) | Min 120 × 96, ≥ 44 target | Solid `--bg-elevated`, `--radius-md`; pressed scale 0.97; selected/added: checkmark badge, no red ring |
| **KPI** | Label (Footnote `--label-2`), value (Figure L), delta (icon + % + "vs …") | — | Grouped by spacing in one solid card; hairline between KPIs; delta colour semantic + arrow icon |
| **Receipt** | Monospace body on solid paper surface | 58/80 mm widths | `--bg-elevated` (light paper even in dark mode), BIR header caps allowed |

Plans (owner decision): plan cards are identical solid cards that differ only by content; the recommended plan carries the view's one filled button and a plain "Recommended" label. The plan tab is removed from working chrome; the current plan is shown in Settings › Plan and billing.

---

## G. Page structure

- **Landing (Persuade, Apple product-page style).** Follows the system theme (light and dark, no always-dark ground). Sticky glass nav bar (lockup · Product · Pricing · Download · Questions · one filled "Get started"). Hero: a specific headline, one sentence, one filled CTA + one plain link, and **the real Terminal screen shown large** (the signature). Sections are full-width bands separated by spacing (96–128 px), each with a specific headline and a real product screen. Pricing: identical solid cards, recommended plan with the one filled button. FAQ as an inset grouped list. No grid, trace, ports, glows or ambient motion.
- **App shell (Operate).** macOS/iPadOS: full-height glass sidebar + unified glass toolbar; solid content on `--bg` with solid cards. Phones: glass tab bar (≤ 5) + large titles; one navigation pattern only (no hamburger plus tab bar).
- **Terminal (iPadOS).** Fills the viewport (no device stage). Leading glass rail (Sell, Orders, Kitchen, Shift, More); solid product grid; solid cart column with the total in Figure XL and Charge (56 px, full width) at the bottom. Selling screens render from local data and never block on a Supabase call; network state is a small status item in the rail.
- **Sign-in.** One centred solid card (max 420) on `--bg`, static lockup above; no 2D/3D emblem art.

---

## H. Clean URLs and route map (Hostinger)

| Clean URL | Serves | Notes |
|---|---|---|
| `/` | `landing.html` | `DirectoryIndex` |
| `/app` | `index.html` | The app; signed-out visitors see sign-in. Hash routes stay (`/app#/owner/dashboard`) |
| `/login` | `index.html` | App opens on sign-in (`location.pathname` read at boot) |
| `/signup` | `index.html` | App opens on "Create an account" |
| `/plans` | `index.html` | App opens `#/plans` |
| `/admin` | `admin/index.html` | Already a folder |
| `/privacy` | `legal/privacy.html` | |
| `/terms` | `legal/terms.html` | |

301 redirects (query strings preserved, no loops — rewrite rules test `THE_REQUEST`, not the rewritten URI): `/landing.html` → `/`, `/index.html` → `/app`, `/admin.html` → `/admin`, `/legal/privacy.html` → `/privacy`, `/legal/terms.html` → `/terms`. Internal links, canonical tags, `sitemap.xml`, `manifest.webmanifest` (`start_url: /app`) and the service worker's navigation keys move to the clean URLs. The Electron and Capacitor wrappers keep loading `index.html` from their local copy (no rewrites there). Supabase Auth: Site URL `https://<host>/`, redirect URLs `https://<host>/app**` (plus the wrappers' local and deep-link URLs); auth callbacks keep working on the old URL through the 301 because query strings are preserved.

---

## I. Implementation checklist (for every new screen)

1. Tokens only — no raw colours, radii, durations or font sizes.
2. One filled primary; ≤ 7 navigation items; targets ≥ 44 pt (POS primary ≥ 56 px).
3. Glass only on bars and overlays; content solid; fallbacks in place.
4. Tabular numerals on every number; money via the shared parser/formatter.
5. Every async action has loading, empty, error and success states.
6. Semantic HTML (`<main>`, one `h1`, landmarks), labelled icon buttons, visible focus, keyboard path, forced-colours check.
7. Motion: transform/opacity only, durations from tokens, reduced-motion alternative.
8. Check at 375, 768, 1024, 1440 px; light and dark; reduced transparency; reduced motion; increased contrast.

---

## J. Charts — rounded ends (owner direction, 19 Nov)

Every column is fully round at its data end (radius = half its width) and softly round on the baseline (30% of its width, at least 4 px); stacked parts stay joined. Donut arcs keep round caps; meters and ranked bars are pills; heatmap cells use 8 px corners and calendar cells 30% corners. Lines (when used) take `stroke-linecap: round; stroke-linejoin: round`.

## K. Sign-in motion (owner direction, 19 Nov)

The sign-in page answers the person without moving on its own:
- **The orb** — the static Cleo emblem inside a disc of Liquid Glass. It leans toward the pointer (up to 7° / 9° and 10 px; a soft light follows the pointer on its surface), springs back when the pointer leaves (`--ease-spring`, 700 ms), and gives a small press "pop" (0.95 → 1) on a tap.
- **Entrance** — the card rises 14 px and fades in once (420 ms ease-out); its fields follow 40 ms apart.
- **Fields and buttons** — a focused field lifts 1 px as its ring eases in; buttons press to 0.97 and spring back.
- **Reduced motion** — no tilt, no entrance, no lift; the page is still.
