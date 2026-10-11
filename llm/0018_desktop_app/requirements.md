# Summary

Ship devsesh as a desktop app for macOS and Linux. Windows comes later. The phone keeps using the web app.

The desktop app is a thin shell around the existing web app. It loads the devsesh server URL in an embedded browser (Electron). It adds a small native bridge for things a browser page cannot do.

First goal of the app: unlock the **master key** with the operating system's hardware-backed keys, so that the Secure Enclave works on macOS as the user expects. Later goals (not in this project): port forwarding, reverse port forwarding, SSH agent forwarding.

The master key is unlocked today with WebAuthn PRF. A spike showed that PRF and passkeys are a poor fit inside a desktop app on macOS. So on macOS the app does **not** use WebAuthn to unlock the key. It wraps the master key with a key that lives in the Secure Enclave. Linux uses a FIDO2 security key.

The project also adds a server record for every **client** (passkeys and desktop apps), and renames today's CLI pairing to **host pairing**.

# Terminology

- **Host**: a machine that runs `devsesh` sessions (table `hosts`).
- **Host pairing**: what `devsesh login` does today. The CLI gets a code, the user approves it at `/pair`, and the CLI gets a token (`cmd/login.go`, `internal/auth/pairing.go`, table `pairing_codes`). Today the code and UI call this just "pairing".
- **Client**: something a person uses to reach devsesh and unlock the master key. Today: a passkey in a browser. New: a desktop app install.
- **Client pairing**: the new flow that links a desktop app to the user's account and gives it the master key.
- **Unlock provider**: native code that wraps and unwraps the master key with a hardware-backed key on one device.

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
- Unwrapping needs the private key, so macOS shows Touch ID. The round trip matched. It took about 1.8 s including the prompt.
- The spike used `.userPresence`, which also accepts the login password. The real app must not (see macOS provider).
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
- MK is stored as one wrapped blob per device, per passkey (`credential_key_blobs`, `sql/00020_create_credential_key_blobs.sql`). `web/src/lib/crypto/prf.ts` derives the wrapping key with HKDF from the WebAuthn PRF output (salt `devsesh-master-key-v1`). The blob format is `version(0x01) || nonce(12) || AES-GCM ciphertext`.
- Unlock flow: `web/src/components/SSHTerminal.tsx` calls `navigator.credentials.get()` with PRF, fetches the blobs (`getMasterKey` in `web/src/lib/api.ts:249`), tries each blob, then calls `initWorker(masterKey)` (`web/src/contexts/FROSTContext.tsx:78`).
- The FROST worker keeps the share in memory for 30 minutes (`web/src/lib/frost-client.ts:51`).
- `initWorker` logs the master key's length and first 4 bytes to the console today (`web/src/contexts/FROSTContext.tsx:79-80`).

## How a new device is added today

- The new device shows a code. A working device enters it, and they run SPAKE2 over a WebSocket (`web/src/pages/RegisterPasskeyPage.tsx`, table `passkey_enrollments`). The working device sends MK, encrypted with the session key.
- Both branches end with a passkey:
    - New passkey: `navigator.credentials.create()`, then `enrollmentComplete(code, credentialJSON, blob)` (`RegisterPasskeyPage.tsx:413`).
    - Synced passkey with a new device PRF: `navigator.credentials.get()`, then `addMasterKeyBlob(credentialId, blob)` (`RegisterPasskeyPage.tsx:253-274`).
- So today every enrolled device is a passkey, and the server keeps its blobs. The passkey list (`GET /api/v1/auth/passkeys`, `web/src/pages/PasskeyManagementPage.tsx`) is in effect the list of web clients.
- Login tokens are stateless JWTs (`internal/auth/jwt.go`). There is no server-side revocation today.

# Requirements

## Scope and platforms

* The desktop app targets macOS and Linux. The phone keeps using the web app, unchanged [req.dizgpe]
* **This project is done when the app works on both macOS and Linux**: shell, client pairing, hardware-backed unlock, clipboard [req.64ob25]
* Windows is not required for the first version. The design must not block a later Windows provider [req.x0bg6y]
* The web app keeps working in a normal browser on every platform, with the current WebAuthn PRF unlock [req.vlbbqk]
* **The web version stays fully supported on desktop (macOS, Windows, Linux).** The desktop app is optional. A desktop user can use Safari, Chrome or Firefox exactly as today and loses nothing that works now [req.wq3k8m]
* Features that only the app can provide (hardware-backed unlock, native clipboard, and later forwards) are additions. The web app shows them only when the bridge exists, and never blocks normal use without it [req.hn7d2t]
* The web build is the same build for browsers and the app. There is no app-only fork of the web code. Differences are decided at runtime by checking for `window.devseshNative` [req.px9c4f]
* Web changes are tested in a plain browser first. A change must not make the browser path depend on the bridge [req.fy5r1j]
* The desktop app has no separate UI. It loads the web app from the devsesh server URL, so web updates reach the app without a new release [req.ob361u]
* The app uses the same server URL as the browser. Its login and cookies are separate from the browser's. Browser passkeys are not expected to appear in the app [req.ov6rce]
* This project covers the shell, the native bridge, client pairing, the clients list, the host pairing rename, and master-key unlock. Forwards are out of scope (see Non-goals) [req.cl46dt]

## App shell

* The app uses Electron, so the browser engine is the same on every platform [req.43uxhz]
    - Tauri was rejected. It uses the system web view (WebKitGTK on Linux), and WebAuthn support differs per platform.
* The app asks for the server URL on first start and stores it. It can be changed later. Only `https://` URLs are accepted [req.i97kqn]
* The window loads only that origin. Navigation to other origins is blocked, and new windows are denied [req.o6f9dj]
* The renderer runs with `contextIsolation` on, `nodeIntegration` off and `sandbox` on [req.uok6aq]
* The app works with a server that uses a private CA [req.zah5fi]
    * The user can import a CA certificate in the app. The app trusts it only for the configured server host [req.yupakn]
    * Certificate errors for any other host, or for a certificate not signed by the imported CA, still fail [req.g39mni]
    * Do not use `--ignore-certificate-errors`, an SPKI allow-list switch, or a blanket certificate-error handler outside the spike [req.sp90k0]
    - Electron 42 ignores the OS keychain for private CAs, which is why the app needs its own trust.
* Build output goes under `build/` (project rule). The app source lives in its own top-level folder, for example `desktop/` [req.hghnst]

## Native bridge

* The preload script exposes one object, `window.devseshNative`, only inside the app. Its absence means "running in a browser" [req.sjzqw7]
* The bridge has a small fixed API, grouped by feature. First version: `version`, `platform`, `auth` (client token), `unlock` and `clipboard` [req.783bwo]
* `window.devseshNative.version` is the bridge version. The web app checks it and hides features an older app does not support [req.dy09pd]
* The main process only answers calls from the trusted origin over `https`. It checks the sender frame URL on every call [req.r29heo]
* `unlock` calls are only accepted after a user gesture in the page (for example a click on "Connect") [req.yifqm1]
* No generic "run command" or "read file" call exists. Every call is a named operation with validated arguments [req.zam7ei]
* The web app detects the bridge and falls back to its current behavior when the bridge is missing or a feature is unavailable [req.og2yk8]
* Bridge calls return structured errors (`code`, `message`). Codes include at least `cancelled`, `not_available`, `not_enrolled` and `failed` [req.gq99r0]

## Clients

- A client is anything that can unlock the master key for a user: a browser passkey or a desktop app install.

* A new `clients` table lists every client of a user, for both kinds [req.1guuna]
    * Columns at least: `id`, `user_id`, `kind` (`passkey` or `desktop`), `name`, `platform`, `created_at`, `last_used_at` [req.aygsty]
    * A `passkey` client points to its row in `webauthn_credentials` [req.zaelol]
    * A `desktop` client records the unlock provider (`secure_enclave`, `fido2`), a hash of its client token, and its wrapped master key (`wrapped_master_key`, same format as the PRF blob) [req.j246zl]
* A migration creates one `passkey` client for every existing `webauthn_credentials` row. No existing passkey stops working [req.rc15hj]
* Hosts are not clients. `hosts` and host pairing stay separate from `clients` [req.v23td8]
* The `wrapped_master_key` of a `desktop` client opens only with that device's hardware key. The server sees ciphertext only, as with passkey blobs today [req.c0uokb]
    * The app fetches the blob from the server after it unwraps its client token (`GET /api/v1/clients/{id}/key`, client token required) [req.8m3vhc]
    * The server returns a `desktop` blob only to the token of that same client, never to other clients or the browser [req.t5n1zq]
* The passkey management page becomes a **Clients** page. It lists passkeys and desktop apps together, with kind, name, platform, created and last used [req.1xxn07]
    * The user can add a passkey from it, as today [req.3l3rkz]
    * The user can rename and remove any client [req.fwxgtp]
    * Removing a `passkey` client also deletes its credential and its blobs, as deleting a passkey does today [req.n2npq9]
    * Removing a `desktop` client deletes its row and blob and revokes its token at once. The next request from that app fails with 401, and the app deletes its local token and enclave key when it sees that [req.j3g0yi]
* The UI and API refuse to remove the user's last client that can unlock the master key [req.qskvxz]
* `GET /api/v1/clients` lists clients. The old passkey endpoints keep working for one release, then are removed [req.ywcl31]
* Update `doc/TABLES.md` and `doc/SERVER_ENDPOINTS.md` with the new table and endpoints [req.k4t5in]

## Host pairing rename

* Today's CLI pairing (`devsesh login`) is called **host pairing** everywhere: code, UI text, docs and README [req.1lt999]
    * Go: rename the handlers and types (for example `PairStartHandler` to `HostPairStartHandler`) and the file `internal/auth/pairing.go` to match [req.h1m2ln]
    * Web: `PairPage` becomes the host pairing page, with text that says it links a host [req.qt7ssq]
    * CLI: `devsesh login` output says "host pairing code" [req.jslnsd]
* The new desktop flow is called **client pairing**. No code or UI uses plain "pairing" without "host" or "client" [req.s3ap6h]
* Old URLs and API paths keep working, so older CLIs can still log in [req.9a28ws]
    * `/pair` stays as the host pairing page or redirects to its new path [req.c5th6q]
    * `/api/v1/auth/pair/*` stays as an alias of the new host pairing paths [req.wqg5uu]
* The `pairing_codes` table may keep its name. Its docs say it is for host pairing [req.tdfdkw]

## Client pairing (enrollment and login)

- One flow gives the desktop app both a login and the master key. It reuses the SPAKE2 channel from passkey enrollment.

* On first start (after the server URL), the app shows a client pairing code. The user enters it on a device that is already a client (a phone or a browser with a passkey) [req.iovox5]
* The working device asks the user to unlock (its passkey PRF, as today), then sends the master key over the SPAKE2 channel, as in passkey enrollment [req.rkicvl]
* The working device's user approves the new client by name and platform. Only then does the server finish the client pairing [req.vjx9wd]
* When the client pairing finishes [req.x0j0g1]
    * The server creates a `desktop` row in `clients` and returns a client token to the app. No WebAuthn credential is created [req.e7ma6p]
    * The app wraps the master key with its unlock provider and uploads the blob to its client row. The client token is the only secret kept on the device [req.5v9ilu]
    * The app checks that the master key decrypts the FROST client share before it reports success [req.7d1yzr]
* The server allows a pairing to finish without a WebAuthn credential only for client pairings. Passkey enrollment is unchanged [req.fikrfu]
* Setup always needs a second device that can already unlock. The app cannot pair itself [req.4dlago]
* The client token is wrapped by the unlock provider, like the master key. It is never stored in plain text, in the OS keychain, or in the Linux Secret Service [req.rgwa2b]
    * The app unwraps the token once per app start, with user presence (Touch ID or a security key touch). It keeps the token in memory only, and the main process gives it to the web app through `auth.getToken()` [req.3b8k2d]
    * If the provider is not available, the app refuses to pair and says why [req.7q4m9x]
    - The OS keychain and the Secret Service are protected by the login password only. That breaks the rule below, so they are not used for any secret.
* The server checks every request made with a client token against `clients`. A removed client's token is rejected even before it expires [req.m6su43]
* Pairing again on the same device replaces the old client row (with its blob), token and enclave key [req.st6h91]
* The user can remove this device from the app's settings. This deletes the enclave key and the local token, and removes the `clients` row with its blob [req.82lr4h]
* Logging out in the app keeps the enrollment. Removing the device is a separate, explicit action [req.l3ideo]
* The enclave key label and the local token are keyed by server host and user ID. Several accounts or servers on one machine never share a key [req.z7kytv]
* The browser login (passkey) is not offered inside the app on macOS. Electron's built-in Touch ID passkeys are not used [req.88liut]
    - They have no PRF, and client pairing already gives the app a login.

## Unlock providers

* Each platform has one **unlock provider** with this interface: `isAvailable()`, `enroll(masterKey)`, `unlock()`, `remove()` [req.jibqdh]
* `unlock` returns the master key and requires user presence on the hardware every time [req.z70o3f]
* **There is never a password fallback.** No provider accepts the OS login password or any other typed secret instead of the hardware check [req.vl4r87]
* The master key is returned to the web app's unlock code. The web app then calls `initWorker(masterKey)` as it does today [req.ttrlfv]
* The web app unlock flow becomes: if the bridge reports an enrolled provider, use it. Otherwise use the current WebAuthn PRF flow [req.mogag4]
* Unlock errors are handled like this [req.10mj5o]
    * Cancelled prompt: result `cancelled`. The web app shows a retry button and does not start another prompt by itself [req.l1o0u6]
    * Blob missing on the server, key gone, or key invalidated: result `not_enrolled`. The web app offers client pairing again [req.d2qotu]
    * The unwrapped key does not decrypt the FROST client share (the master key changed): the app deletes the local enrollment and offers client pairing again [req.p3d6dc]
* The wrapped master key starts with a version byte, as the PRF blob does [req.a8gdtq]
* The master key is passed as bytes. The helper and the main process zero their buffers after use. In page JavaScript this is best effort [req.d8087f]
* `isAvailable()` is false when the hardware is missing. The app then says why and that the browser can be used instead [req.99b2ae]

### macOS: Secure Enclave

* The provider creates a P-256 key in the Secure Enclave with access control `.privateKeyUsage` and `.biometryCurrentSet`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, in the data-protection keychain [req.urh5lz]
    - `.biometryCurrentSet` means Touch ID only. No password, no Apple Watch.
    - Adding or removing a fingerprint invalidates the key. Unlock then returns `not_enrolled` and the user pairs again.
* Creating the key and wrapping need no prompt. Wrapping uses ECIES `eciesEncryptionCofactorX963SHA256AESGCM` with the public key [req.y58apz]
* Unwrapping uses the enclave private key and shows the Touch ID prompt [req.qur9f0]
* The unwrap prompt text says what is being unlocked (for example "Unlock your devsesh master key") [req.mypvfl]
* A Mac without Touch ID (or with the lid closed and no Touch ID keyboard) reports `isAvailable() = false` [req.8t9tde]
* The code runs in a signed helper inside its own `.app` bundle, with the app's provisioning profile and the same bundle identifier (see lessons). The main process starts one helper process per call and talks JSON over stdin/stdout [req.52rlle]
* The helper accepts a fixed command list only. Secrets travel on stdin, not on the command line (the spike used arguments; that is not acceptable for the real app) [req.6bobx5]
* The helper checks that its parent process is signed with the app's Team ID and refuses to run otherwise [req.uqay9t]
* The key is device-bound. A new Mac or a re-installed OS means a new client pairing [req.ocnyqe]

### Linux: FIDO2 security key

* The provider uses a FIDO2 security key with the `hmac-secret` extension. User presence is a touch on the key [req.2kqdxo]
    - A PIN that the key itself requires is allowed. It is checked by the key and does not replace the touch, so it is not a password fallback.
* The first implementation step checks, on a Linux machine, whether Electron's built-in WebAuthn gives PRF with a USB security key [req.2hm34y]
    * If it does, the Linux provider uses it inside the app, with the blob kept on the server client row [req.4wsxzr]
    * If it does not, the provider calls the key directly through `libfido2` from the main process [req.ar35dw]
    * The result is recorded in this folder before the provider is built [req.x8oq7n]
* A TPM key without user presence, or a software keyring (Secret Service), is **not** accepted as an unlock provider. They need no hardware check [req.wwqc7g]
* No security key connected: `isAvailable()` is false, with a message to plug one in [req.kwdwqw]

### Windows (later)

- Not in the first version. The likely design: the wrapping key in the TPM through the Microsoft Platform Crypto Provider (CNG), with Windows Hello for user presence. The exact API (CNG with a UI policy, or `KeyCredentialManager`) needs a spike on a Windows machine.
- Windows Hello allows a PIN. That must be checked against the "never a password fallback" rule before Windows is built.

## Clipboard

* The bridge provides `clipboard.write(text)` and `clipboard.read()` using Electron's `clipboard` module. No user gesture or key combo is needed [req.i8k9u5]
* The web app uses the bridge for copy and paste when it exists, and keeps the current gesture-based flow (see `llm/0017_clipboard/requirements.md`) in browsers [req.vcgp0x]
* Paste still goes through xterm's `term.paste()` so bracketed paste protects the remote shell [req.fof1d4]

## Security

* **Every secret the app keeps on disk is encrypted by a hardware token** (Secure Enclave or FIDO2 security key). This covers the master key and the client token. A key that depends only on the login password is not accepted [req.h9w2ts]
* Every master-key unlock requires user presence on the hardware (Touch ID or a security key touch). No silent or cached unlock in the provider [req.e9k3n9]
* The bridge returns the master key only to the trusted origin. The page can read it during unlock, the same exposure as the PRF flow today. A later hardening step could move the FROST worker into the main process [req.ghiv2k]
* All IPC handlers validate argument types and sizes. Master keys are exactly 32 bytes [req.lfq6u5]
* The app logs no secrets. Logs may include provider name, result code and timing [req.cmaq27]
* Remove the master-key logging in `web/src/contexts/FROSTContext.tsx:79-80`. No web code logs master-key bytes [req.ycnijw]
* The helper and the app are signed [req.cwdecq]
* Removing the device from settings always deletes the enclave key. If the app was deleted without that, the leftover key is deleted at the next enrollment on that machine [req.5yk283]
    - macOS has no uninstall hook, so cleanup on drag-to-trash is not possible.
* Client tokens are stored only as a hash on the server [req.itcles]

## Distribution and signing

* macOS builds are signed with the paid team. Development builds use an Apple Development certificate. Release builds use Developer ID Application and are notarized [req.1rk6ra]
* The bundle identifier is chosen once and used everywhere: the app, the helper bundle, the provisioning profile, the keychain access group [req.wa2te8]
* The build script wraps the helper in its own `.app` with a copy of the profile, signs it, and then signs the app (reproducing `add-helper.sh`) [req.wr5sml]
* The release process documents how to create the App ID and the provisioning profile, and which certificate is used for what [req.bslx8d]
* Linux builds ship as an AppImage. Other packages are decided later [req.b4q82w]
* Auto-update is out of scope for the first version. It needs a stable signing identity on every platform [req.2ro1sx]
* `flake.nix` lists everything needed to build and test the app (Node, Electron tooling, `libfido2` if used). Swift builds happen on a Mac and are not part of the Linux flake [req.lydabq]

# Open questions

- **Apple passkey API (iCloud passkeys and PRF in the app).** Dropped for now. It could come back if the association file can be served from a public address for the devsesh domain. Needs a proper test with a real public host.
- **Linux engine.** Electron's built-in WebAuthn PRF or `libfido2`. Decided by the first Linux implementation step (see Linux provider).
- **Apple Silicon and a second Mac.** The spike used one Intel Mac. A universal build and a second paired Mac are untested.
- **Client token lifetime.** How long a client token lives and how it is refreshed. The token is unwrapped once per app start, so each start needs one Touch ID or key touch. A short-lived token with a hardware-wrapped refresh token is an option.
- **Client pairing code direction.** The app shows the code and a working device enters it (as in passkey enrollment). Confirm this, or let the working device show the code instead.

# Non-goals / future

- Windows support. It gets its own follow-up.
- Moving the FROST worker into the main process, so page JavaScript never sees the master key. The web app has the same exposure today, so the app is no worse. It can be a later hardening project.
- Port forwarding, reverse port forwarding and SSH agent forwarding. The desktop app exists partly to make these possible later. They get their own project.
- Supporting iCloud-synced passkeys and PRF inside the app on macOS.
- Auto-update, tray icon, start on login.
- A native (non-web) UI.
- Replacing the browser unlock flow. The browser keeps WebAuthn PRF.

# Implementation details

* This project is only complete when the AGENT/LLM implementing this creates ALL applicable unit tests AND INTEGRATION TESTS, and ALL INTEGRATION TESTS and UNIT TESTS are passing [req.3axqgj]
* The agent/llm shall NOT stop until integration and unit tests are fully written, executed, and passing [req.9hf50i]
* The Secure Enclave, Touch ID and security key touches cannot be driven by automated tests. Tests use a **fake unlock provider** behind the same interface, and the manual macOS and Linux checks are listed explicitly in the test notes [req.55n2j6]
* Integration tests exercise the web app with a fake `window.devseshNative` (auth, unlock, clipboard) in Chromium, and cover the fallback to WebAuthn PRF when the bridge is missing [req.fn6xb0]
* Electron main-process and IPC tests run headless on Linux (for example Playwright `_electron` with Xvfb) from `integration_tests/integration_tests.sh` [req.cnu9yh]
* Add tests for the main-process IPC handlers: sender origin check, `https` check, user gesture check, argument validation, and the helper command allow-list [req.f40299]
* Add server tests for client pairing, the `clients` migration of existing passkeys, client token revocation, the last-client guard, and the old host pairing paths [req.n03p6f]
* Update markdown documents under `doc/` (for example `doc/ARCHITECTURE.md`, `doc/TABLES.md`, `doc/SERVER_ENDPOINTS.md`) and the README with the desktop app, client and host pairing, how to build and sign it, and how unlock providers work [req.vbm6o1]
* Update `flake.nix` and put all build output under `build/` [req.q88knj]
