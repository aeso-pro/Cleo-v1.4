# Windows and Android apps: releases and updates

Cleo POS ships as two installers, built by GitHub Actions from this repository:

| | File | Made from | Updates |
| --- | --- | --- | --- |
| Windows 10 or 11, 64-bit | `Cleo-Setup.exe` | `apps/desktop` (Electron) | Installed copies check the latest release, download it in the background and offer **Restart now**. |
| Android 9 or later | `Cleo.apk` | `apps/android` (Capacitor) | The app checks the latest release when it starts and shows **Download** when a newer one is out. |

Both carry the same app as the website (`index.html` and its files, copied by `tools/build-app-web.js`) and sign in to the same Cleo accounts. Every business's data stays in its own account on the server.

The landing page's download buttons always point at the newest release:
`https://github.com/aeso-pro/Cleo-v1.4/releases/latest/download/Cleo-Setup.exe` and `…/Cleo.apk`. The line under them shows the version, read from GitHub.

The first release is **v1.4.1** (the tag v1.4.0 was used for a build that failed and has no release).

## Make a release

1. Commit and push the changes to `main`.
2. Tag the version and push the tag. The tag is the version number:

   ```bash
   git tag v1.4.1
   ```

   ```bash
   git push origin v1.4.1
   ```

3. GitHub › Actions › **Release apps** builds both apps (about 10 minutes) and publishes the release with `Cleo-Setup.exe`, `Cleo.apk` and `latest.yml` (what the Windows app reads to update itself).

Use a higher number every time (1.4.1, 1.4.2, 1.5.0). An Android phone only installs a version over an older one, and the Windows app only updates to a higher one.

## Android signing key (do this once, before the first real release)

Android installs an update only if it is signed with the same key as the version already on the phone. Until the key below is set, each release is signed with a temporary key, and phones must uninstall the old version first (their data is safe: it is in the Cleo account).

Make the key on your own computer (Android Studio includes `keytool`). Choose the passwords yourself and keep the file safe; nobody else should have them:

```bash
keytool -genkeypair -v -keystore cleo-release.jks -alias cleo -keyalg RSA -keysize 2048 -validity 10000
```

Then add four repository secrets in GitHub › Settings › Secrets and variables › Actions:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The key file as base64 (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cleo-release.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `cleo` |
| `ANDROID_KEY_PASSWORD` | The key password |

Losing the key means existing installs can't be updated, only reinstalled. Keep a backup of the file and its passwords.

## Windows signing (optional)

The Windows installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time; **More info › Run anyway** installs it. A code-signing certificate removes the warning: add it as `CSC_LINK` and `CSC_KEY_PASSWORD` secrets and pass them to the Windows build step.

## Sign-in inside the apps

Google doesn't allow sign-in inside an app's own window, so both apps open it in the device's browser:

- **Windows** serves the app to its window from `http://127.0.0.1:47823`. After Google, the browser comes back to that address, shows "Back to Cleo POS", and the app finishes the sign-in.
- **Android** asks Google to come back to `online.cleopos.app://auth-callback`, which opens the app.

Both addresses are on the sign-in allow list in Supabase › Authentication › URL Configuration › Redirect URLs (`http://127.0.0.1:47823/**` and `online.cleopos.app://**`). Email and password sign-in needs nothing extra.

Payments open PayMongo's page in the browser. When it's done, the plan shows in the app the next time it loads the business (or after **Sync now**).

## Build locally

```bash
cd apps/desktop && npm ci && npm run dist
```

That makes `apps/desktop/dist/Cleo-Setup.exe`. The Android app needs Java 21 and the Android SDK; the release workflow has both, so build it there.
