# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Owners** of Philippine small and mid-sized businesses (food and beverage, retail, services). They sign up and set up Cleo on the web, choose a plan, and run the business from the Owner Dashboard and Back Office.
- **Cashiers, servers and kitchen staff** who sell on an Android tablet or POS device (the Terminal), signing in with a 4-digit staff PIN, often under time pressure at a counter.
- **Managers, HQ managers, accountants and inventory clerks** who work in the Back Office.

## Product Purpose

Cleo is an offline-first point of sale designed to support Philippine invoicing workflows. BIR functionality and applicable accreditation must be validated separately before sale. It makes bookkeeping and BIR reporting a by-product of selling, shows owners revenue and profit in one place, and connects branches under one catalog, stock pool and customer base. Success: a new owner gets from sign-up to a first sale quickly, and cashiers never wait on the software.

## Positioning

Built for Philippine rules and payments: BIR invoicing (RR 7-2024), X- and Z-readings, electronic journal, statutory SC/PWD discounts, QR Ph, GCash, Maya and GoTyme. The Terminal keeps selling with no internet.

## Operating Context

- One web app with three modes: Terminal, Owner Dashboard, Back Office. Sign-in, sign-up and setup come first; a mode picker follows for plans that include more than the Terminal.
- Proposed tiers: Basic (PHP 1,499 monthly, Terminal only), Pro (PHP 2,999 monthly, all three modes for one branch), Max (PHP 4,999 monthly, multi-branch management), plus custom Enterprise. A branch subscription includes one terminal; additional licenses use discounted rates. Annual first-terminal prices are ten monthly fees; additional terminals are prepaid at twelve monthly fees, as confirmed by the user. See content/plans.md and source/licensing.js.
- Sign-up flow: account, email verification, business, then choose a plan and pay. Basic opens the Terminal directly with no mode switching; Pro and Max show the three modes. An Enterprise call request keeps the person on the plan page.
- A Basic terminal is standalone: everything it needs (staff, business rules, menu, plan and billing) is managed on the terminal, with no dependency on the Owner Dashboard or Back Office.
- There is no backend yet; `source/api.js` simulates Cleo Cloud, payment providers and OAuth.

## Capabilities and Constraints

- Built from `Frontend/source/` into one `index.html` with `node source/build.js`; vanilla JS and CSS, no framework or packages. Fonts, icons and images are local (offline use).
- Card details are never typed into Cleo: cards go through the payment provider's own page; wallets are linked by approving in the wallet's app.
- Chromium-based browsers are the target (matches the Android WebView); liquid-glass refraction is Chromium-only.
- Prices in `content/plans.md` are sample prices until pricing is final.

## Brand Commitments

- Name: Cleo, by Aeso Technologies Inc. Original Cleo emblem and Aeso artwork (`assets/brand/`), Helvetica Neue (licensed font files), Phosphor icons, Cleo red accent, which a business can replace with its own brand colour.
- Voice: plain, short, direct English for Philippine business owners and staff.
- Google and Facebook sign-in keep their official marks and the wording "Continue with Google" and "Continue with Facebook".

## Evidence on Hand

- Demo business "Kapé Lumen" (`source/data.js`) with sample branches, staff, products and sales. All figures are demo data; do not present them as real customers or results.
- No testimonials or customer logos are available. Proposed commercial prices are supplied in content/licensing-proposal.md and remain subject to validation.

## Product Principles

- Speed at the counter beats decoration: frequent cashier actions stay immediate.
- One home per setting, and every setting a plan needs is reachable inside that plan.
- Work offline first; never lose a sale.
- Invoicing records should come from normal use; do not claim validated compliance or accreditation from this preview.

## Accessibility & Inclusion

Touch-first terminal use (44px minimum targets), keyboard access and visible focus on the web, reduced-motion and reduced-transparency support.
