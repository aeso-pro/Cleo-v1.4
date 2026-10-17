# Cleo design system

The built system lives in `source/core.css` (tokens, materials, controls) with each mode's stylesheet on top. This file records the decisions behind it; the code is the authority for exact values.

## Character

An operational POS for Philippine businesses with an Apple-like glass language: translucent functional layers over a quiet backdrop, Helvetica Neue, Phosphor icons and the Cleo red. Calm and precise rather than decorative. Speed at the counter wins over effects.

## Colour

- **Accent:** Cleo red `#d40000` (`--accent`), with `--accent-ink` for text-safe red (`#ff5a4f` dark, `#c20000` light). A business can replace it with its brand colour (`applyBrand` keeps text contrast at 4.5:1).
- **Neutrals:** `--ink` to `--ink-4` and `--line`, `--line-2`, `--wash`, `--wash-2`, as alpha on the ground (`#0d0d0e` dark, `#f3f3f4` light).
- **Status:** `--good`, `--warn`, `--serious`, `--bad`, `--info`, each with a `-soft` fill.
- **Strategy:** restrained. Red marks the primary action, the current selection and the recommended plan; it never fills large areas.

## Materials (glass)

- `.glass`: floating functional layers (cards that hold controls, the plan cards, the sign-up card). Blur 26px, saturation 165%, a bright top edge (`--glass-hi`), a hairline rim (`--glass-rim`), a soft top sheen (`--spec`) and `--shadow-lg`.
- `.glass-thick`: dense data surfaces; more opaque so text stays crisp.
- `.glass-thin`: chips and buttons on top of other material; no blur. Never stack light glass on light glass.
- `LiquidGlass.attach()`: an SVG displacement refraction (Chromium) for hero surfaces: the sign-in card, the recommended plan, dialogs.
- **Backdrop:** dark mode has drifting ambient light and, on sign-in screens, the lit box grid. Light mode has a few faint, still lights (`--amb-1` to `--amb-4`) so its glass reads as glass; no glows, grain or motion.
- **Fallbacks:** `prefers-reduced-transparency` makes glass solid; `prefers-contrast: more` makes it solid with a stronger rim.

## Type

Cleo Sans (Helvetica Neue, local files). Tracking tightens as size grows: display `-.025em` to `-.035em`, titles `-.02em`, body `.005em`. Prices and totals use weight 300 at large sizes with tabular numerals (`.num`). Headings use `text-wrap: balance`. No eyebrow labels above headings.

## Shape and space

Radii `--r-xs` 8 to `--r-xl` 32; buttons and chips are pills; cards 24 to 32; inputs 12. Plan logos are bare vector trees. Spacing groups tightly inside a control and opens up between sections.

## Motion

Custom curves: `--ease-out` for entrances, `--ease-in-out` for movement, `--ease-drawer` for sheets. UI motion stays under about 300ms; presses scale to .97 instantly; lists rise with a 45ms stagger. Screens change with opacity and transform only. Reduced motion removes movement and keeps fades.

## Components added for account setup

- **Setup progress** (`Cleo.setupGuide`): five steps (Account, Verify, Business, Plan, Payment); done steps turn into checks, the current one is filled; on phones it becomes a horizontal row.
- **Plan logos** (`Cleo.planLogo`, `.plan-mark`): a tree drawn like a circuit trace, as a plain line drawing in `--ink` with no colour, frame, glow or motion. Every branch ends in a node and the crown is a ring around a core. Each trunk starts where its first branch leaves it, and each logo is centred in a 52-unit square at the same scale. Basic is a two-branch sapling, Pro and Max share a four-branch tree (both open all three modes), and Enterprise a fuller tree, only a little wider than Pro: the trunk splits into two short limbs that each fork into an upright and an outward twig, with two more branches high on the trunk below the crown. Spacing rule: nodes at least 8 units apart, at least 9.5 from the crown, and at least 7 from any line they are not on, so each plan has its own silhouette. Plan cards stay neutral: no plan colours or effects; the current plan gets a neutral ink outline and a plain badge.
- **Plan cards** (`Cleo.planCard`, the plan page and Owner Dashboard › Plan and billing): from the top, the logo; the name (30px) and tagline; the price with "per branch / a month" stacked beside it, then the billing line and what one terminal and extra terminals cost (`Cleo.planPrice`); a status box when there is something to say (your plan, a call requested, too many terminals); a full-width action with a short note under it; then a full-width rule and what the plan includes. The seven rows line up across cards (CSS subgrid) so prices, buttons, summaries and lists align; on narrow screens the cards stack. The recommended plan has the primary button and refracting glass. Owner › Plan and billing shows the lists open and prices for the subscription's own billing cycle.
- **Plan tabs** (plan page): two large two-line tabs under the heading, "Growth plans" (Basic, Pro and Max) and "Enterprise" (custom scope and pricing), on a hairline with an ink underline that slides to the open tab (340ms). Arrow keys, Home and End move between them; `#/plans/enterprise` opens the Enterprise tab. Growth holds the billing switch, the cards, the quotation and the two disclosures; Enterprise holds one glass panel: the plan on the left (logo, name, "Custom · priced for your business", unlimited branches and terminals, status, Talk to sales as the primary button) and, on the right, "Everything in Max, plus:" and a three-step "How it works" (request a call, agree the scope, roll out with help). A call request keeps the owner on the tab.
- **Billing switch** (plan page): a large segmented control, Monthly or Annually, centred over the plans, with a small green "2 months free" tag worked out from the prices. It re-prices the cards in place: the big number stays per branch per month (on Annually, the yearly price over twelve months) and the line under it reads "₱14,990 billed yearly · save ₱2,998". Each changed figure blurs and rises into place (280ms, 35ms apart card to card; a plain fade with reduced motion). The quotation calculator's billing cycle follows the switch both ways, and the choice carries into the payment page.
- **Feature fold** (plan page): each card's includes row shows the plan's one-sentence `Summary` from content/plans.md and a "See all N features" pill with a caret. One pill opens or closes every card's list together, so the plans stay comparable side by side; the lists unfold from 0 to full height while fading and un-blurring (340ms), and a folded list is `inert`. The disclosure rows below the calculator use the same caret in a pill.
- **Disclosures under the quotation**: each row is a title with a one-line description and the caret pill; the content unfolds (Chromium `::details-content` with `interpolate-size`). The feature comparison sits on a thick-glass surface (so the backdrop doesn't show through the rows), with one column per plan (logo, name and its per-month price, which follows the billing switch); the plan row sticks to the top of the page while the rows scroll (the table clips its corners with `overflow: clip`, not a scroll box). Groups are quiet labels with a count, rows highlight on hover, included is a bold check and not included a grey minus. "Only differences" hides the rows every plan shares (36 to 21) and announces the count. On phones the plan columns narrow to 64px and drop the logos and prices, so the table never scrolls sideways. The licensing terms are a definition list: a short label (Licenses, Billing, Branches, Not included, Tax and compliance, Still to define) beside the proposal's own wording, with the exclusions as chips; the label moves above the text on phones.
- **Payment page**: summary panel (plan, terminal stepper, VAT-inclusive lines, total) beside the payment panel (card or wallet radio list, mobile number for wallets, one Pay button, a privacy line, then a waiting and success state in place).
- **Payment chips** (`Cleo.billing.chip`): text placeholders in each wallet's colours until official logos are added.

## Licensing proposal integration

The three priced cards are Basic, Pro and Max, under the Growth plans tab. Enterprise has its own tab with Talk to sales. Max uses Pro's four-branch tree. Cards retain the existing neutral glass materials, alignment and typography.

The quotation calculator follows the cards; it offers plan, total terminals, branches for Max, and billing cycle. Monthly and annual totals come from the same function used in checkout and both billing summaries. Annual extras are twelve monthly fees paid upfront, as confirmed by the user. Copy quotation includes the breakdown and exclusions; a selectable-text fallback handles unavailable clipboard access.

The 36-row feature comparison and licensing terms expand below the calculator. They explicitly describe proposed inclusions, not implemented or accredited services. The table scrolls within its container on phones. Checkout returns scroll and keyboard focus to its heading. Its two glass panels stack on narrow screens, and large totals can wrap.

## Accessibility

44px touch targets on coarse pointers, visible focus rings, labels above inputs, errors below them and announced, radio groups with arrow keys, `aria-current="step"` on the progress, and status regions for payment waiting and success.

## Landing extension: The lit grid

The October 15 refinement keeps ambient grid boxes at half their prior opacity near the trace, fading to transparent over a 216px radius. A smooth spatial ramp restores the original grid through the closing section. The line and Cleo emblems retain their visibility. Cache the proximity field on layout changes, reuse separable lighting buffers, and advance motion by elapsed time; do not restore per-cell exponentials, repeated full-document icon scans or inherited scroll-transform variables.

The opening keeps a minimal field at 26–38% of the original ambient strength, quieter behind the headline and fading toward the hero device. A slow light wash animates those boxes. Three illuminated grid strands glide through the footer panel itself, behind the Cleo logo, links and copyright, blending neighboring cell rows to avoid stepping; the page ends at the footer, with no separate strip below it. The footer's type carries a soft halo in the ground color, and uses full ink in light mode, so it stays readable over the lit boxes. Both ornaments use the existing canvas and motion clock, cache geometry on layout changes, skip offscreen work, and freeze with the shared pause/reduced-motion setting.

The landing's full feature comparison opens in a native dialog over pricing. Keep all 36 source-defined features, a differences-only filter, billing-aware header prices, sticky column headings, a scrollable table and focus restoration. The solid reading surface protects legibility over the grid. Pause continuous background drawing while a dialog covers it. Root URLs present the landing; explicit `index.html` remains the operational app and installed-app start page.

### Overview

This section applies only to the standalone marketing surface (`source/landing.html` and its landing partials, styles and script). It extends Cleo's sign-in box grid and glass materials; the app, setup and plan guidance above remains in force for those surfaces. The approved surface direction stays in `.impeccable/surfaces/source-landing-html.md`. Values below come from the implementation, including the final control-size, recommendation-label and offline-panel fixes.

**The Same Cleo Rule.** Use the original Cleo emblem and Aeso artwork, the existing Cleo typeface, and actual Terminal, Owner Dashboard and Back Office captures. The illuminated opening and closing marks sample the original emblem; they are not new brand marks. Keep sample-data captions visible.

### Colors

- **Ground and text:** dark ground (`#0b0b0d`), warm white ink (`#f4f3f1`) and muted text (`#a9a8ae`); light ground (`#f1f0ed`), near-black ink (`#141416`) and muted text (`#55545a`). These landing values do not replace the app tokens.
- **Accent:** Cleo red (`#d40000`) lights the grid and fills primary actions. Text-safe red is landing-specific (`#ff5d52` dark; `#b30000` light). Neutral panes retain their glass fill as the trace lights their rims.
- **Grid lights:** dark ambient colors are `rgb(212 0 0/.55)`, `rgb(122 6 16/.65)`, `rgb(255 112 52/.2)` and `rgb(54 62 84/.45)`; light mode uses `rgb(212 0 0/.32)`, `rgb(236 110 92/.42)`, `rgb(255 166 124/.42)` and `rgb(120 138 190/.3)`. The hero and closing have stronger illumination than reading sections. This landing has a lit grid in both themes; it does not change the app's still-light-theme rule.

### Typography

Cleo Sans loads on the landing from the app's own files in `assets/fonts` (300, 400 and 500 are preloaded), so the opening never waits for the screen captures. The copies embedded in the capture CSS are registered only for a weight whose file fails to load. Preserve those font files and weights rather than introducing a separate display family. The body is 400 at 16px/1.55; large headings use weight 300 and balanced wrapping; peso figures use tabular numerals.

- **Hero:** `clamp(50px,6.4vw,96px)`, line-height `.98`, tracking `-.04em`; at 540px and below, `clamp(44px,12.4vw,56px)`.
- **Section headings:** `clamp(40px,4.5vw,64px)`, line-height `1.02`, tracking `-.035em`; 38px at 540px and below. Workspace headings use `clamp(30px,2.6vw,38px)` with line-height `1.05`.
- **Prices:** weight 300, 54px, line-height `.95`, tracking `-.035em`; 44px at 1100px and below. Supporting section copy is 17px/1.6, reducing to 16px on small phones.

### Layout

The shared container is `min(1240px,calc(100% - 64px))`, with 24px side gutters at 1100px and below and 16px at 540px and below. Section spacing opens to `clamp(96px,13vh,150px)` above content. The hero device is `min(100%,62vw,980px)` wide, becoming full container width below 900px.

Workspace rows reserve a central channel for the trace: copy / 96px channel / screen in a 4:8 proportion, changing to 5:7 with a 72px channel at 1100px and below. Local panes use two columns; prices use three. Below 900px these sections stack, and the trace becomes a left rail with 30px content clearance (26px at 540px and below). The sticky glass navigation switches to a menu below 900px; on small phones the motion control is in that menu.

### Elevation & Depth

Glass uses 26px blur, 165% saturation, a one-pixel rim, an inset top highlight and diffuse shadows. Landing fills are `rgb(22 22 26/.52)` in dark mode and `rgb(255 255 255/.56)` in light mode; the denser fill is `rgb(17 17 21/.76)` or `rgb(255 255 255/.8)`. Keep the readable pane distinct from the illuminated ground; this landing does not attach the app's SVG glass-refraction effect. Reduced transparency removes backdrop blur and uses the denser fill; the enlarged-screen dialog uses the ground color. Increased contrast strengthens text and rims and removes glass blur.

### Shapes

**The Grid Continuity Rule.** Align the page-anchored trace to the same box centers as the backdrop: 18px cell pitch, 5px gap, 13px visible square, 3.5px corner radius. The CSS fallback repeats that geometry. Trace ports are circular (22px); their position follows the grid when the layout changes.

Device frames and desktop content panes use 30px corners, with 20px corners around captured screens. Below 900px devices reduce to 24px / screens to 16px; at 540px and below they become 20px / 14px. Other small-screen panes use 24px and price cards 26px. Buttons and segmented controls remain pills (99px radius).

### Components

- **Controls:** regular actions are at least 50px high. Small actions and billing-cycle buttons are at least 44px high; icon and terminal-stepper buttons are 44px square, and the numeric input is at least 44px high. Focus uses a 2px text-safe red outline with 4px offset. Button state transitions use 200ms; the landing easing is `cubic-bezier(.23,1,.32,1)`. Fine-pointer hover lifts actions 2px; a press scales to `.97`.
- **Real screens:** the hero eagerly loads a Terminal capture; later workspace captures load near the viewport. Each is a scaled 1440-by-960 DOM capture in an empty-sandbox iframe, with an inert body, disabled pointer interaction and animation, no app scripts, and a restrictive CSP. The parent supplies the accessible enlarge button and native dialog, including fit and full-size zoom. The captures are visual evidence, not interactive app sessions; fonts are shared from their CSS with the landing.
- **Offline illustration:** place the connection heading and status icon together in a flex row, without an eyebrow. The labeled switch changes the explanatory text and dims the cloud's slate light while retaining the counter's red. Preserve the illustration/backend qualification; this is not a live connection test.
- **Pricing:** reuse monochrome circuit-tree marks and data-derived plan content. The landing renders the recommendation badge as “Recommended” without changing the plan data. Billing and terminal controls update the visible peso figures and quote handoff; keep sample-pricing qualifications with them. This presentation does not replace the app's plan tabs, comparison or setup flow.
- **Trace and motion:** the marketing trace connects the hero Terminal, three workspaces, local panes and pricing ports. It advances to a reading line at 62% of viewport height; running motion adds traveling light, fine-pointer illumination and ripples on open ground. The opening uses eased fades/rises and a 1.6s device entrance; it can finish early on user input, ends with its last animation rather than on a timer, and is skipped when the page opens scrolled. The lit mark is timed from the headline's own animation, so it leads even when the script runs after first paint. The screen captures (about 4 MB) sit at the end of the page, after its scripts, so the page paints before they arrive. The hero capture is built once the mark has handed over (1.6s in). The other captures load one at a time while the page is idle, or as soon as one nears the viewport, so building one rarely coincides with scrolling. The ambient grid draws at about 30 fps on its own; scrolling and other requests draw on the next frame. These story timings and scroll effects belong to this marketing page, not the app's operational motion system.

**The Still Story Rule.** Stop the continuous canvas loop while the document is hidden. A saved pause choice or system reduced-motion preference stops autonomous light, pointer effects, ripples and hero scroll transformation; keep static trace rendering responsive to scrolling, resizing and theme changes. Reduced motion takes precedence over the page toggle and removes CSS animation, near-eliminates transitions and disables smooth scrolling. Pause also finishes the opening and skips animated price changes; it is not a blanket removal of every CSS control transition.

### Do's and Don'ts

- **Do** keep the grid, trace and ports aligned through responsive layout and font loading, and maintain readable screen enlargement and sample-data captions.
- **Do** retain original Cleo/Aeso identity assets and the existing circuit-tree plan marks; all foreground imagery must remain evidence from Cleo.
- **Don't** turn the marketing story, longer entrances, illuminated light theme or landing-specific colors into global app rules.
- **Don't** present captured screens, the offline illustration or proposed pricing as live services, customer results or validated accreditation. Product constraints remain in `PRODUCT.md`.
