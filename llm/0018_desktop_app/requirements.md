# Summary

Ship devsesh as a desktop app for macOS, Windows and Linux. The phone keeps using the web app.

The desktop app is a thin shell around the existing web app. It loads the devsesh server URL in an embedded browser (Electron). It adds a small native bridge for things a browser page cannot do.

First goal of the app: unlock the **master key** with the operating system's hardware-backed keys, so that the Secure Enclave works on macOS as the user expects. Later goals (not in this project): port forwarding, reverse port forwarding, SSH agent forwarding.

The master key is unlocked today with WebAuthn PRF. A spike showed that PRF and passkeys are a poor fit inside a desktop app on macOS. So the app does **not** use WebAuthn to unlock the key. It wraps the master key with a key that lives in the Secure Enclave (macOS), and uses the equivalent on other platforms.

# Background: what the spike learned

- The spike code and raw notes are in `spike/electron-passkey/` (`NOTES.md`). Test machine: Intel MacBook (T2), macOS 15.6.1, Xcode 26.3, Electron 42.11.12.
- The browser version stays as it is. The browser already gives Touch ID, iCloud passkeys and PRF on a Mac.

## What did not work, and why

- **Free Apple account.**
    - Xcode refuses to create a profile with the Associated Domains capability: "Personal development teams … do not support the Associated Domains capability".
    - Apple's passkey API for apps needs that capability. So it needs the paid Developer Program.
- **Apple's passkey API (`ASAuthorization`) inside Electron, with the paid account.**
    - Stock Electron has no iCloud or Touch ID passkey support on macOS. The open-source `vault12/electron-webauthn-mac` addon adds it.
    - The app must prove it owns the domain. The server serves `/.well-known/apple-app-site-association`, and Apple's system fetches it.
    - On our private server (`*.leo-sa.com`, tailnet only) this never worked. Apple's service never contacted our test server, even with `?mode=developer` and `swcutil developer-mode -e true`.
    - `swcutil dl` failed with "Connections to private/reserved IP addresses are not allowed".
    - Apple's forums report the same flakiness with private servers. The known workarounds are a public staging server or a tunnel.
    - So this route needs a public endpoint for the association file. It was not proven that a public endpoint fixes it.
- **The addon uses its own challenge.** It makes a random WebAuthn challenge, so a server-issued challenge cannot be used. We patched it (`spike/electron-passkey/patches/server-challenge.patch`). It only offers ES256, and PRF only for platform passkeys.
- **Electron's built-in Touch ID passkeys** (`app.configureWebAuthn({ touchID: { keychainAccessGroup } })`, Electron 41+).
    - Registration worked, and the server challenge came back correctly.
    - The passkeys are device-bound (no iCloud sync). Existing iCloud passkeys do not appear.
    - **No PRF.** `prfEnabled` was false, and a `get()` returned no PRF value. So it cannot unlock the master key.
    - Needs the `keychain-access-groups` entitlement.
- **Electron 42 does not use the macOS keychain trust for private CAs.** Electron 39 did. The spike worked around it with `--ignore-certificate-errors-spki-list`. A real deployment with a publicly trusted certificate does not need this. A private CA does.
- **Platform quirks already known** (`docs/design/ssh-passkey-per-device-master-key.md`): PRF from an iCloud passkey differs per Apple device, and Safari needs `evalByCredential`.

## What worked: Secure Enclave key wrapping

- A Swift helper creates a P-256 key in the Secure Enclave (`kSecAttrTokenIDSecureEnclave`, access control `.privateKeyUsage + .userPresence`, data-protection keychain). Source: `spike/electron-passkey/se-helper/main.swift`.
- Wrapping uses ECIES (`eciesEncryptionCofactorX963SHA256AESGCM`) with the public key. It never prompts. A wrapped 32-byte secret is 113 bytes.
- Unwrapping needs the private key, so macOS shows Touch ID (or the password). The round trip matched. It took about 1.8 s including the prompt.
- Over plain SSH (no desktop session) the key cannot even be looked up ("No keychain is available"). Nothing can use it without a logged-in user.
- Called from the Electron app through IPC, it worked end to end.
- No domain, no public endpoint and no passkey are involved.

## Signing and packaging lessons

- `keychain-access-groups` is a restricted entitlement. It needs a provisioning profile, so the paid program.
- **A bare helper binary is killed by macOS** (exit 137, AMFI). The helper must live in its own small `.app` bundle with a copy of the provisioning profile and its own signature. Spike script: `spike/electron-passkey/app/add-helper.sh`.
- The helper bundle must use the same bundle identifier as the app. The profile in the spike is tied to one explicit bundle ID.
- Re-sign the outer app after adding the helper.
- The Team ID did not change when the free account became a paid one. The existing Apple Development certificate kept working.
- `xcodebuild` needs `-allowProvisioningUpdates -allowProvisioningDeviceRegistration` the first time. The Mac must be registered as a device on the account.
- Xcode showed an Apple ID but `xcodebuild` reported "No Accounts" until the account was removed and added again in the Xcode app.
- Native Node addons that use N-API (as the passkey addon does) must not be rebuilt by electron-builder. Set `npmRebuild: false`.
- Certificates: use **Apple Development** while developing, **Developer ID Application** (plus notarization) to ship outside the App Store. The App Store and installer certificates are not needed.

## How the web app unlocks the master key today

- One master key (MK) per user. It decrypts the FROST client share, which signs the short-lived SSH certificates.
- MK is stored as one wrapped blob per device (`credential_key_blobs`). `web/src/lib/crypto/prf.ts` derives the wrapping key with HKDF from the WebAuthn PRF output (salt `devsesh-master-key-v1`). The blob format is `version(0x01) || nonce(12) || AES-GCM ciphertext`.
- Unlock flow: `web/src/components/SSHTerminal.tsx` calls `navigator.credentials.get()` with PRF, fetches the blobs (`getMasterKey` in `web/src/lib/api.ts:249`), tries each blob, then calls `initWorker(masterKey)` (`web/src/contexts/FROSTContext.tsx:78`).
- A device that has no blob is provisioned over the existing SPAKE2 enrollment channel. A working device sends MK, and the new device adds a blob (`addMasterKeyBlob`, `web/src/lib/api.ts:268`).
- The FROST worker keeps the share in memory for 30 minutes (`web/src/lib/frost-client.ts:51`).

# Requirements

## Scope and platforms

* The desktop app targets macOS, Windows and Linux. The phone keeps using the web app, unchanged [req.dizgpe]
* The web app keeps working in a normal browser on every platform, with the current WebAuthn PRF unlock [req.vlbbqk]
* **The web version stays fully supported on desktop (macOS, Windows, Linux).** The desktop app is optional. A desktop user can use Safari, Chrome or Firefox exactly as today and loses nothing that works now [req.wq3k8m]
* Features that only the app can provide (hardware-backed unlock, native clipboard, and later forwards) are additions. The web app shows them only when the bridge exists, and never blocks normal use without it [req.hn7d2t]
* The web build is the same build for browsers and the app. There is no app-only fork of the web code. Differences are decided at runtime by checking for `window.devseshNative` [req.px9c4f]
* Web changes are tested in a plain browser first. A change must not make the browser path depend on the bridge [req.fy5r1j]
* The desktop app has no separate UI. It loads the web app from the devsesh server URL, so web updates reach the app without a new release [req.ob361u]
* The app uses the same origin as the browser, so existing logins, cookies and passkeys keep their meaning [req.ov6rce]
* This project covers the shell, the native bridge, and master-key unlock. Forwards are out of scope (see Non-goals) [req.cl46dt]
* **macOS is the first platform.** Windows and Linux providers are specified here but may ship later [req.64ob25]

## App shell

* The app uses Electron, so the browser engine is the same on all three platforms [req.43uxhz]
    - Tauri was rejected. It uses the system web view (WebKitGTK on Linux), and WebAuthn support differs per platform.
* The app asks for the server URL on first start and stores it. It can be changed later [req.i97kqn]
* The window loads only that origin. Navigation to other origins is blocked, and new windows are denied [req.o6f9dj]
* The renderer runs with `contextIsolation` on, `nodeIntegration` off and `sandbox` on [req.uok6aq]
* The app must work with a server that uses a private CA, because the current server does [req.zah5fi]
    - Electron 42 ignores the OS keychain for private CAs, so the app needs its own way to trust a user-supplied CA certificate.
    - Do not use `--ignore-certificate-errors` or a blanket certificate-error handler outside the spike.
* Build output goes under `build/` (project rule). The app source lives in its own top-level folder, for example `desktop/` [req.hghnst]

## Native bridge

* The preload script exposes one object, `window.devseshNative`, only inside the app. Its absence means "running in a browser" [req.sjzqw7]
* The bridge has a small fixed API, grouped by feature. First version: `unlock` (see below) and `clipboard` [req.783bwo]
* The main process only answers calls from the trusted origin. It checks the sender frame URL on every call [req.r29heo]
* No generic "run command" or "read file" call exists. Every call is a named operation with validated arguments [req.zam7ei]
* The web app detects the bridge and falls back to its current behavior when the bridge is missing or a feature is unavailable [req.og2yk8]
* Bridge calls return structured errors (`code`, `message`). The web app can tell "user cancelled" from "not available" from "failed" [req.gq99r0]

## Unlock providers

- An unlock provider wraps and unwraps the master key with a hardware-backed secret on this device.

* Each platform has one **unlock provider** with this interface: `isAvailable()`, `enroll(masterKey)`, `unlock()`, `remove()` [req.jibqdh]
* `enroll` takes the 32-byte master key, wraps it, and stores the wrapped blob on the device. It never needs user presence [req.y58apz]
* `unlock` returns the master key and requires user presence every time (see Security) [req.z70o3f]
* The master key is returned to the web app's unlock code. The web app then calls `initWorker(masterKey)` as it does today [req.ttrlfv]
* The web app unlock flow becomes: if the bridge reports an enrolled provider, use it. Otherwise use the current WebAuthn PRF flow [req.mogag4]
* The master key is never written to disk unwrapped, never logged, and the app zeroes its own copy after handing it over [req.d8087f]

### macOS: Secure Enclave

* The provider creates a P-256 key in the Secure Enclave with access control `.privateKeyUsage` and `.userPresence`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, in the data-protection keychain [req.urh5lz]
* Wrapping uses ECIES `eciesEncryptionCofactorX963SHA256AESGCM` with the public key. Unwrapping uses the enclave private key and shows the system prompt [req.qur9f0]
* The unwrap prompt text says what is being unlocked (for example "Unlock your devsesh master key") [req.mypvfl]
* The code runs in a signed helper inside its own `.app` bundle, with the app's provisioning profile and the same bundle identifier (see lessons). The main process starts it and talks JSON over stdin/stdout [req.52rlle]
* The helper accepts a fixed command list only. Secrets travel on stdin, not on the command line (the spike used arguments; that is not acceptable for the real app) [req.6bobx5]
* The key is device-bound. A new Mac or a re-installed OS means a new enrollment [req.ocnyqe]
* The access control allows the password as a fallback to Touch ID, so adding a fingerprint or an unavailable sensor does not lock the user out. Using Touch ID only (`.biometryCurrentSet`) is a future setting [req.vl4r87]
    - Open question: is the password fallback acceptable? See Open questions.

### Windows

* The provider keeps the wrapping key in the TPM through the Microsoft Platform Crypto Provider (CNG), with Windows Hello for user presence [req.egopbm]
    - Not tested in the spike. The exact API (CNG with a UI policy, or `KeyCredentialManager`) is to be chosen and proven first.
* If no TPM or Windows Hello is available, `isAvailable()` is false and the web app uses the WebAuthn PRF flow [req.ys6ojm]

### Linux

* The provider uses a FIDO2 security key with the `hmac-secret` extension, or a TPM 2.0 key if one is present [req.2kqdxo]
    - Not tested in the spike. Chromium in Electron already supports PRF with USB security keys, so the existing WebAuthn flow may be enough. That keeps Linux on the browser path for now.
* A software-only keyring (Secret Service) is **not** accepted as an unlock provider by default. It is not hardware-bound [req.wwqc7g]

## Enrollment

* A device enrolls with the existing SPAKE2 channel. A working device sends the master key, and the new device wraps it with its provider [req.iovox5]
    - This is the same "add blob" branch as `docs/design/ssh-passkey-per-device-master-key.md`, with a provider instead of a PRF.
* The app can enroll from inside the app with a clear action ("Set up this device"). It does not ask for a new passkey [req.x0j0g1]
* The wrapped blob is stored **only on the device** (the app's user-data folder or the OS keychain). The server stores nothing new [req.5v9ilu]
    - Rationale: a Secure Enclave blob only opens on that Mac, so a server copy adds nothing. See Open questions.
* The user can remove the device's blob and key from a settings screen. This deletes the enclave key [req.82lr4h]
* Enrolling twice replaces the old blob. The old enclave key is deleted first [req.st6h91]
* The user always keeps at least one other way to unlock (another enrolled device or a browser passkey). Losing a device must not lose the master key [req.qskvxz]

## Login to the server

- The desktop app still needs a login to the server. This is separate from unlocking the master key.

* The app can log in with the existing pairing flow (`pair/start`, `pair/exchange`, `pair/complete`, as the CLI does), with the token stored in the OS keychain [req.d4lofk]
* The web login (passkey) keeps working in the app where the engine supports it. On macOS, Electron 41+ built-in Touch ID passkeys create a device-bound passkey [req.88liut]
    - They have no PRF, so this passkey only logs in. It never unlocks the master key.
    - Open question: pairing only, built-in passkey only, or both. See Open questions.

## Clipboard

* The bridge provides `clipboard.write(text)` and `clipboard.read()` using Electron's `clipboard` module. No user gesture or key combo is needed [req.i8k9u5]
* The web app uses the bridge for copy and paste when it exists, and keeps the current gesture-based flow (see `llm/0017_clipboard/requirements.md`) in browsers [req.vcgp0x]
* Paste still goes through xterm's `term.paste()` so bracketed paste protects the remote shell [req.fof1d4]

## Security

* Every master-key unlock requires user presence (Touch ID, password or Windows Hello). No silent or cached unlock in the provider [req.e9k3n9]
* The master key reaches only the FROST worker flow. The bridge never returns it to any page other than the trusted origin [req.ghiv2k]
* The web page can read the master key during unlock. This is the same exposure as the PRF flow today. A later hardening step could move the FROST worker into the main process [req.dphffd]
* All IPC handlers validate argument types and sizes. Master keys are exactly 32 bytes [req.lfq6u5]
* The app logs no secrets. Logs may include provider name, result code and timing [req.cmaq27]
* The helper and the app are signed. The helper refuses to run if called by an unsigned parent where the platform allows that check [req.uqay9t]
* Removing the app or the enrollment deletes the Secure Enclave key (best effort on uninstall, guaranteed from the settings screen) [req.5yk283]

## Distribution and signing

* macOS builds are signed with the paid team. Development builds use an Apple Development certificate. Release builds use Developer ID Application and are notarized [req.1rk6ra]
* The bundle identifier is chosen once and used everywhere: the app, the helper bundle, the provisioning profile, the keychain access group [req.wa2te8]
* The build script wraps the helper in its own `.app` with a copy of the profile, signs it, and then signs the app (reproducing `add-helper.sh`) [req.wr5sml]
* The release process documents how to create the App ID and the provisioning profile, and which certificate is used for what [req.bslx8d]
* Windows builds are code-signed. Linux builds ship as AppImage and a distro package. Exact formats are decided later [req.b4q82w]
* Auto-update is out of scope for the first version. It needs a stable signing identity on every platform [req.2ro1sx]
* `flake.nix` lists everything needed to build and test the app (Node, Electron tooling). Swift builds happen on a Mac and are not part of the Linux flake [req.lydabq]

# Open questions

- **Password fallback.** `.userPresence` accepts the login password when Touch ID fails. `.biometryCurrentSet` is stricter but invalidates the key when fingerprints change. Which one is the default?
- **Where the blob lives.** Local only is simplest. A server copy would let the app show "this device is enrolled" in the web UI. Is that worth a schema change?
- **How the app logs in on macOS.** Pairing token, built-in Touch ID passkey, or both?
- **Moving the FROST worker to the main process.** It would stop page JavaScript from ever seeing the master key. It is a larger change. Do it in this project or later?
- **Apple passkey API (iCloud passkeys and PRF in the app).** Dropped for now. It could come back if the association file can be served from a public address for the devsesh domain. Needs a proper test with a real public host.
- **Windows API choice.** CNG with a Windows Hello UI policy, or `KeyCredentialManager`. Needs a spike on a Windows machine.
- **Linux.** Is the existing WebAuthn PRF flow with a security key enough, or is a TPM provider needed?
- **Apple Silicon and a second Mac.** The spike used one Intel Mac. A universal build and a second enrolled Mac are untested.
- **Private CA support.** What is the cleanest way to let the user trust their own CA inside the app (import dialog, system store, or pinning)?

# Non-goals / future

* Port forwarding, reverse port forwarding and SSH agent forwarding. The desktop app exists partly to make these possible later. They get their own project [req.pojohi]
* Supporting iCloud-synced passkeys and PRF inside the app on macOS [req.3e6px1]
* Auto-update, tray icon, start on login [req.axawyu]
* A native (non-web) UI [req.vuksr4]
* Replacing the browser unlock flow. The browser keeps WebAuthn PRF [req.biy2js]

# Implementation details

* This project is only complete when the AGENT/LLM implementing this creates ALL applicable unit tests AND INTEGRATION TESTS, and ALL INTEGRATION TESTS and UNIT TESTS are passing [req.3axqgj]
* The agent/llm shall NOT stop until integration and unit tests are fully written, executed, and passing [req.9hf50i]
* The Secure Enclave and Touch ID cannot be driven by automated tests. Tests use a **fake unlock provider** behind the same interface, and the manual macOS check is listed explicitly in the test notes [req.55n2j6]
* Integration tests exercise the web app with a fake `window.devseshNative` (unlock, clipboard) in Chromium, and cover the fallback to WebAuthn PRF when the bridge is missing [req.fn6xb0]
* Add tests for the main-process IPC handlers: sender origin check, argument validation, and the helper command allow-list [req.f40299]
* Update markdown documents under `doc/` (for example `doc/ARCHITECTURE.md`) and the README with the desktop app, how to build and sign it, and how unlock providers work [req.vbm6o1]
* Update `flake.nix` and put all build output under `build/` [req.q88knj]
