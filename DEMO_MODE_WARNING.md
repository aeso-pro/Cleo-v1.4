# ⚠️ Read this first: why the app may look empty

> **Opening `index.html` normally no longer shows the sample café.** The app starts on the real backend, which doesn't exist yet. You'll see a sign-in that can't succeed and empty "not connected" screens. **The design, animations and effects are all still there.** They appear when the app runs on sample data, which needs `?demo` in the address.

## What you'll see without `?demo`

- A sign-in screen that says *"Cleo isn't connected to its server yet"*, with an **Explore the demo** link.
- Signing in fails, because there's no server to check the account.
- The old shortcuts, such as `index.html#/terminal/app` and `index.html#/owner/app`, also stop at sign-in.
- The Owner Dashboard has no charts, figures or live sales feed. Its report views say *"Sales, profit and stock figures appear once Cleo is connected"*.
- The Terminal has no products, tables or orders, and the Back Office shows empty lists.

## Why

The backend-readiness cleanup required **no sample data in normal use**, so a real business never sees made-up sales, customers or tax numbers.

The sample café (Kapé Lumen) feeds almost all of the app's motion: the charts that draw in, the live sales feed, the product tiles, kitchen tickets and incoming delivery orders. It now loads only in demo mode, and without data there's nothing for those animations to draw.

No stylesheet was changed or removed. The landing page differs by two links.

## How to see the full design

Add `?demo` right after `index.html`. It works with VS Code Live Server and with `node source/serve.js`.

| Open | Shows |
| --- | --- |
| `index.html?demo#/terminal/app` | The Terminal, signed in, with the sample café |
| `index.html?demo#/owner/app` | The Owner Dashboard |
| `index.html?demo#/backoffice/app` | The Back Office |
| `index.html?demo` | Sign-in for the demo (any email and password work) |
| `landing.html` → **Try the Terminal demo** | The Terminal in demo mode |
| `index.html?demo=off` | Back to the real (empty) mode |

With the preview server (`node source/serve.js`), these are `http://localhost:5175/index.html?demo#/terminal/app` and so on.

- `?demo` lasts for that browser tab, so you only need it once per tab.
- Demo data is saved separately (`cleo:demo:*` in the browser) and never mixes with real data.
- **Reset demo data**, at the bottom of the demo's mode picker, starts the sample café over.

## Making the demo the default (until the backend exists)

To open the app with the sample café every time, including from the landing page's **Sign in** and **Get started**:

1. Create `Frontend/.env` containing:
   ```
   CLEO_DATA_SOURCE=demo
   ```
2. Rebuild:
   ```
   node source/build.js
   ```

> **⚠️ Before going live:** remove that line, or set `CLEO_DATA_SOURCE=supabase`, and build production with `CLEO_DEMO=off`. Otherwise the sample café ships to real customers. `.env` is never committed or served.

## What looks different in real mode on purpose

These changes apply only without `?demo`. The demo is unchanged.

- **Loading screen:** it's shorter. The timed steps ("Checking this device", "Checking your session") were removed, because nothing was running behind them. The lit-grid animation still plays during the real start-up.
- **Owner Dashboard top bar:** it reads *"Updated"* followed by the time the data loaded instead of *"Live · updated just now"*. It switches to "Live" once real sales arrive.
- **Owner Dashboard live feed:** the auto-generated sales feed is off. Real sales will appear as the backend sends them.

## More detail

- `../Docs/FRONTEND_CLEANUP_REPORT.md`: what was moved into demo mode, and what was verified.
- `../Docs/BACKEND_INTEGRATION_GUIDE.md`: how the real backend connects.
- `README.md`, under "Data sources": build settings and storage keys.
