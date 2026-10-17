# Cleo assets

Everything the built pages load from disk. All of it is local, so the Terminal works offline and no CDN is needed. `sw.js` caches every file listed in it, so a missing file here stops the service worker from installing.

| Path | What it is | Source |
| --- | --- | --- |
| `fonts/HelveticaNeue{Light,Roman,Medium,Bold}.otf` | Cleo Sans, weights 300, 400, 500 and 700 (licensed font files) | The same files `landing.html` embeds for its screen captures |
| `brand/cleo-emblem.png` | Cleo emblem, 720 × 594 | Original Cleo artwork (also the landing favicon) |
| `brand/aeso-mark.png` | Aeso mark, 512 × 416 | Original Aeso artwork (the landing's "Made by Aeso" mask) |
| `icons/phosphor/{regular,fill,bold}/` | Phosphor icons 2.1.1: `style.css`, `.woff2` and `.woff` | `@phosphor-icons/web@2.1.1` on npm (MIT) |
| `vendor/supabase-js-2.118.0.js` | Supabase browser SDK, UMD build | `@supabase/supabase-js@2.118.0`, `dist/umd/supabase.js` (MIT) |
| `vendor/supabase-js-2.118.0.json` | The SDK's source and integrity | Must match the `integrity` attribute on its `<script>` in `index.html` |
| `vendor/supabase-js-LICENSE.txt` | The SDK's MIT licence | From the same npm package |

To replace the SDK, change the file, its `.json` and the `integrity` attribute in `index.html` together. A browser refuses a script whose digest doesn't match.
