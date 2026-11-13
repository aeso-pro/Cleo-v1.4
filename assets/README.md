# Cleo assets

Everything the built pages load from disk. All of it is local, so the Terminal works offline and no CDN is needed. `sw.js` caches every file listed in it, so a missing file here stops the service worker from installing.

| Path | What it is | Source |
| --- | --- | --- |
| `fonts/HelveticaNeue{Light,Roman,Medium,Bold}.otf` | Cleo Sans, weights 300, 400, 500 and 700 (licensed font files) | The same files `landing.html` embeds for its screen captures |
| `brand/cleo-emblem.svg` | Cleo emblem (2026 rebrand), viewBox 980.27 × 1330.77, red `#d40000` | Traced from the design team's emblem: three round nodes joined by concave fillets, standing like a "<" (one node on the left, two on the right). The source for every emblem on screen; `landing.html` carries the same file as a data URI (its favicon and lit grid mark) |
| `brand/cleo-wordmark.svg` | "Cleo" wordmark, viewBox 1890 × 746, `currentColor` | The design team's wordmark (Helvetica Neue Light, default tracking) as outlines. Drawn as a CSS mask so it takes the text colour; beside the emblem it is 0.45 of the emblem's height, 0.12 of that height away |
| `brand/cleo-emblem.png` | Cleo emblem, 754 × 1024 | Rendered from `cleo-emblem.svg`, for places that need a bitmap |
| `brand/cleo-icon-{32,192,512}.png` | App icons: the emblem centred on a transparent square | Rendered from `cleo-emblem.svg` (favicon, `manifest.webmanifest`) |
| `brand/cleo-maskable-512.png` | Maskable app icon: the emblem at 60% of the height on `#0d0d0e` | Rendered from `cleo-emblem.svg`; stays inside the maskable safe zone |
| `brand/cleo-touch-icon.png` | Apple touch icon, 180 × 180, emblem on `#0d0d0e` | Rendered from `cleo-emblem.svg` |
| `brand/aeso-mark.png` | Aeso mark, 512 × 416 | Original Aeso artwork (the landing's "Made by Aeso" mask) |
| `icons/phosphor/{regular,fill,bold}/` | Phosphor icons 2.1.1: `style.css`, `.woff2` and `.woff` | `@phosphor-icons/web@2.1.1` on npm (MIT) |
| `vendor/supabase-js-2.118.0.js` | Supabase browser SDK, UMD build | `@supabase/supabase-js@2.118.0`, `dist/umd/supabase.js` (MIT) |
| `vendor/supabase-js-2.118.0.json` | The SDK's source and integrity | Must match the `integrity` attribute on its `<script>` in `index.html` |
| `vendor/supabase-js-LICENSE.txt` | The SDK's MIT licence | From the same npm package |

To replace the SDK, change the file, its `.json` and the `integrity` attribute in `index.html` together. A browser refuses a script whose digest doesn't match.
