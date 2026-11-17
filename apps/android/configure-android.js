#!/usr/bin/env node
/* Finishes the Android project that `npx cap add android` generates (android/ is not kept in the repository):
   - the version: versionName from package.json (set from the release tag), versionCode from it, so every
     release installs over the last one;
   - the sign-in return: Google sign-in opens in the phone's browser and comes back to the app through the
     link online.cleopos.app://auth-callback (index.html, backend/supabase.js section);
   - Cleo's icon in place of Capacitor's.
   Run from apps/android after `npx cap sync android`. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const app = path.join(here, 'android', 'app');
const version = require('./package.json').version;
const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
const versionCode = major * 10000 + minor * 100 + patch;
const edit = (file, fn) => { const text = fs.readFileSync(file, 'utf8'); const next = fn(text); if (next === text) throw new Error(`Nothing changed in ${file}`); fs.writeFileSync(file, next); };

// 1. version
edit(path.join(app, 'build.gradle'), (t) => t
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`));

// 2. the sign-in return link, on the app's main activity
edit(path.join(app, 'src', 'main', 'AndroidManifest.xml'), (t) => (t.includes('online.cleopos.app') ? t : t.replace('</activity>', `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="online.cleopos.app" android:host="auth-callback" />
            </intent-filter>
        </activity>`)));

// 3. Cleo's icon (one image for every density; Android scales it), without Capacitor's adaptive icon
const res = path.join(app, 'src', 'main', 'res');
const icon = path.resolve(here, '..', '..', 'assets', 'brand', 'cleo-icon-512.png');
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('mipmap-'))) {
  if (dir.startsWith('mipmap-anydpi')) { fs.rmSync(path.join(res, dir), { recursive: true, force: true }); continue; }
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    if (fs.existsSync(path.join(res, dir, name))) fs.copyFileSync(icon, path.join(res, dir, name));
  }
}
console.log(`Android project ready: version ${version} (code ${versionCode}), sign-in return link, Cleo icon.`);
