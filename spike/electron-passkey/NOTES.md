# Electron passkey spike (Mac)

Goal: check that WebAuthn + PRF work in a desktop app on Mac, with the same
iCloud Keychain / Secure Enclave passkeys as Safari and Chrome.

Test machine: `lap-mac2018.ts.leo-sa.com` (Intel, macOS 15.6.1, Xcode 26.3).
Work dir on the Mac: `~/spike` (Node 22 at `~/spike/node`).

## Findings so far

- `vault12/electron-webauthn-mac` builds on the Mac (`npm run build` OK).
- The addon makes its **own random challenge**. Devsesh needs the server's
  challenge, so the addon must be patched or forked. (`src/PasskeyManager.swift`,
  `randomChallenge`, used by create and get.)
- The addon only offers PRF for **platform** passkeys, not security keys.
- It needs a signed `.app` with the `associated-domains` entitlement and a
  provisioning profile. No unsigned or ad-hoc runs.
- `xcodebuild -allowProvisioningUpdates` on the Mac fails with
  `No Accounts: Add a new account in Accounts settings`. Xcode is not signed in
  as far as the command line can tell. No signing identities exist yet.

## Result: free account is not enough (tested 2026-10-10)

After re-signing in to Xcode, the build gets as far as profile creation and fails:

    Cannot create a Mac App Development provisioning profile for
    "com.leosa.devseshspike". Personal development teams, including
    "Leonardo Sa", do not support the Associated Domains capability.

Team ID `9YDT4ML5X7`, cert "Apple Development: leo@leo-sa.com". Signing itself works.
Passkeys in an app need `webcredentials` Associated Domains, so passkeys
(and PRF) through Apple's API need the paid Developer Program.

## Update: paid account works (2026-10-11)

Team ID stayed `9YDT4ML5X7` (now type Individual). The existing Apple Development
cert still works. Build needs `-allowProvisioningUpdates -allowProvisioningDeviceRegistration`
(the first registers the Mac as a device). Result: `BUILD SUCCEEDED` with profile
"Mac Team Provisioning Profile: com.leosa.devseshspike" and the associated-domains entitlement.

Certificates: use **Apple Development** for testing. Use **Developer ID Application**
(plus notarization) to ship outside the App Store. Apple Distribution and the
Mac Installer certs are for the Mac App Store only. Developer ID Installer is only for `.pkg`.

## Still to test

1. Sign in to Xcode on the Mac, then build `dev-mac-app` with a team.
2. Check that a free (Personal Team) profile allows Associated Domains. It may not.
3. Serve `/.well-known/apple-app-site-association` from the devsesh server.
   Use developer mode (`?mode=developer`) if the host is not public.
4. Compare the PRF output from the app and from Safari on the same Mac.

## Local test setup (2026-10-11)

- `server/` Node HTTPS server (association file + test page), `app/` Electron shell,
  `certs/make-certs.sh` throwaway CA limited to one hostname, `patches/server-challenge.patch`
  (addon accepts the server's challenge).
- On the Mac: hosts entry `11.11.11.11 devsesh-spike.example.net` (+ `ifconfig lo0 alias 11.11.11.11`),
  CA trusted in the login keychain, `swcutil developer-mode -e true`, server run by launchctl label
  `spikeserver`, app copied to `/Applications/DevseshSpike.app`.
- Works: signed app with the associated-domains entitlement launches (LaunchServices records it),
  loads the page, native addon is called with the server challenge, Apple's auth service
  recognizes app id `9YDT4ML5X7.com.leosa.devseshspike`.
- Fails: `Application ... is not associated with domain ...`. Apple's swcd never connects to our
  server (no TLS or HTTP request seen), even in developer mode.
- Apple's `swcutil dl` error: "Connections to private/reserved IP addresses are not allowed"
  (127.0.0.1 and the loopback alias both). `dl` goes through Apple's CDN, so a private
  server cannot pass that route. devsesh.leo-sa.com is private (tailnet), so it needs a
  public endpoint that serves the association file.

## Cleanup needed on the Mac

- `/etc/hosts` line for devsesh-spike.example.net, `ifconfig lo0 -alias 11.11.11.11`
- `launchctl remove spikeserver`, `swcutil developer-mode -e false`
- Delete both "devsesh spike CA (delete me)" certs from the login keychain
- Remove `/Applications/DevseshSpike.app`; the earlier Root CA trust (Leonardo's own CA) stays

## Result: Electron built-in Touch ID (Electron 42.11.12, 2026-10-11)

`app.configureWebAuthn({ touchID: { keychainAccessGroup } })` + `keychain-access-groups` entitlement,
no association file needed. Chromium's own `navigator.credentials` on the Mac:

- create(): works with Touch ID, server challenge round-trips (`challengeIssuedByServer: true`).
- PRF: **not supported**. `prfEnabled: false` on create, and the get() right after returns no PRF result.
- Second get() then failed with NotAllowedError (likely prompt not approved; not investigated since PRF is already missing).
- Needed `--ignore-certificate-errors-spki-list` for the throwaway cert (Chromium 142+ ignores the keychain trust).
- Credentials are device-bound (not iCloud).

Conclusion: devsesh's master-key unwrap needs PRF, so this path cannot unlock SSH on Mac.

## Result: Secure Enclave key wrapping works (2026-10-11)

`se-helper/main.swift` (Swift): P-256 key in the Secure Enclave (`kSecAttrTokenIDSecureEnclave`,
`.privateKeyUsage + .userPresence`, data-protection keychain, access group
`9YDT4ML5X7.com.leosa.devseshspike.se`), ECIES (`eciesEncryptionCofactorX963SHA256AESGCM`).

- create + wrap of 32 random bytes: no prompt (wrap uses the public key only).
- unwrap: Touch ID prompt shown, user approved, round trip matched (`roundTripMatches: true`, 113-byte ciphertext).
- Over plain SSH (no desktop session) the key cannot even be looked up (`No keychain is available`).
- Needs: Apple Development (paid team) signing, `keychain-access-groups` entitlement, and the helper
  wrapped in its own `.app` with a copy of the provisioning profile. A bare binary is killed by AMFI (exit 137).
  No associated domains, no public endpoint.
- `app/add-helper.sh` builds that bundle and re-signs the app.

Not tested yet: calling it from the Electron app (IPC), Touch ID only vs password fallback, a second Mac,
Intel vs Apple Silicon build.

## Result: Secure Enclave unlock from inside the Electron app (2026-10-11)

Page button -> `window.nativeSE.call()` (preload) -> main process `se:call` IPC (sender origin checked,
fixed command list) -> `Contents/Helpers/SEHelper.app/.../se-helper` -> Secure Enclave.

- wrap of a fresh 32-byte master key: ok, 113-byte blob, no prompt (key already existed from the earlier test).
- unwrap: Touch ID, `matches: true`, 1.8 s including the prompt.
- delete of the enclave key: ok.
- Electron 42.11.12, Intel Mac (T2), macOS 15.6.1, paid team, Apple Development cert.
