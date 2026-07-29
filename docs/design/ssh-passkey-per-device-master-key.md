# SSH cert auth: per-device master-key blobs

Status: **LOCKED design** (2026-07-29). Ready to implement behind tests.

## Problem (confirmed from prod logs)

SSH cert auth wraps one **master key (MK)** with a key derived from a passkey's
**WebAuthn PRF** output, storing one blob per passkey
(`webauthn_credentials.encrypted_master_key`). MK decrypts the FROST client
share; the server never sees MK or the share in plaintext.

Two facts break this across Apple devices:

1. **PRF is device-specific for iCloud-synced passkeys.** The *same* synced
   passkey yields a *different* PRF output on each device (Apple-confirmed):
   `PRF(passkey, Mac) ≠ PRF(passkey, iPhone)`. So a blob wrapped on one device
   can't be unwrapped on another, even with the same passkey.
2. **iOS/macOS force the newest synced passkey and expose no choice.** You can't
   select a passkey or a PRF.

Result: **only the device that enrolled the newest passkey can unlock**; every
other Apple device logs in fine but fails to unwrap MK (`OperationError` at
derive-decrypt). Enrolling a new passkey mints a *newer* synced credential that
iOS then forces everywhere → it shadows the other devices → whack-a-mole.

**Scope:** this only affects the **Apple devices that share iCloud-synced
passkeys** (this owner: Mac + iPhone). **Device-bound passkeys (`backup_eligible=0`,
e.g. the Linux laptops) are unaffected** — they don't sync, can't be
force-picked elsewhere, and their existing blob keeps working untouched.

## Goal / non-goals

- Goal: **every device can unlock SSH**, and using/adding a device never breaks
  another.
- Keep exactly **one** master key and one FROST client share — no rotation, no
  CA re-signing. We only add *more wrappings* of the same MK.
- Server never sees MK or the client share in plaintext (unchanged).
- Non-goal: zero-interaction first-time setup on a fresh device (bootstrapping a
  device's blob inherently needs MK from an already-working device).

## Core idea (locked)

Store **N wrapped copies of MK per passkey — one per device** (each wrapped with
that device's PRF). A shared synced passkey ends up with e.g. `blob_mac` and
`blob_iphone`, both hanging off the same credential. On unlock, the device finds
the blob its PRF can open. A device that has none provisions one — **without
minting a new passkey**, so nothing gets shadowed.

```
credential (one synced passkey)
 ├─ blob(PRF(passkey, Mac))     ← only the Mac can open
 └─ blob(PRF(passkey, iPhone))  ← only the iPhone can open
```

## Data model + migration (additive, lossless)

```sql
CREATE TABLE credential_key_blobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id      TEXT NOT NULL REFERENCES webauthn_credentials(id) ON DELETE CASCADE,
  wrapped_master_key BLOB NOT NULL,       -- version || nonce || AES-GCM(KDF(PRF), MK)
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_credential_key_blobs_cred ON credential_key_blobs(credential_id);
```

Backfill preserves every existing blob (nothing lost, no lockout):

```sql
INSERT INTO credential_key_blobs (credential_id, wrapped_master_key, created_at)
SELECT id, encrypted_master_key, created_at
FROM webauthn_credentials WHERE encrypted_master_key IS NOT NULL;
```

Keep the legacy `webauthn_credentials.encrypted_master_key` column for rollback;
drop in a later migration once proven. Linux/device-bound passkeys need no
re-enroll — their migrated blob still works.

## Unlock flow

1. Authenticate with the passkey (iOS forces the synced one; on iOS use a
   **discoverable `get()`** / non-narrowed `allowCredentials` — narrowing to a
   single synced id breaks Safari) → `PRF(passkey, thisDevice)`.
2. `GET /auth/master-key?credential_id=<authed cred>` → **array** of blobs.
3. `key = deriveMasterKeyFromPrf(PRF)`. **Try-all:** AES-GCM-decrypt each blob;
   the GCM tag validates exactly the one wrapped for this device → MK → init
   FROST worker as today.
4. **No blob decrypts** → this device isn't provisioned → launch the provision
   flow (below) instead of erroring.

Try-all needs no extra metadata and covers migrated (untagged) blobs; N = #
devices, tiny. (Optional future optimization: a non-secret `HKDF(PRF,"blob-id")`
tag per blob for O(1) lookup — not in v1.)

## Provisioning = enrollment with an add-blob branch (same endpoints)

The existing cross-device enrollment stays; we add one branch. Triggered when
unlock finds no blob (or from an explicit "set up this device" action). It needs
an **already-working device online** (a Linux laptop) to supply MK over the
SPAKE2-encrypted channel — this is what breaks the chicken-and-egg (MK arrives
out of band, not by unwrapping).

On the device being provisioned:
1. Open the SPAKE2 channel to a working device; receive **MK** (unchanged).
2. `navigator.credentials.get()` to see what passkey is present here → its
   credential id + `PRF(passkey, thisDevice)`.
   - **Existing passkey** (server already has this credential) → wrap MK with
     `PRF(passkey, thisDevice)` → `POST /auth/master-key` to **append a blob** to
     that credential. **No `create()`, no new passkey.** ← the new branch.
   - **No usable passkey here** (fresh Linux box, security key) → fall through to
     today's `create()` path → new passkey + its blob. **Unchanged.**
3. Unlock retries → a blob now decrypts → done.

## Endpoints

- `GET /api/v1/auth/master-key?credential_id=…` → `{ blobs: [base64, …] }` (all
  blobs for that credential; must belong to the JWT user). Replaces the
  single-blob shape.
- `POST /api/v1/auth/master-key { credential_id, wrapped_master_key }` — append a
  blob. JWT-auth'd; verify credential belongs to the user; dedupe byte-identical
  blobs; rate-limit.
- Existing enrollment-complete endpoint unchanged for the new-passkey path.

## Security notes

- Server never sees MK or the client share in plaintext. Each blob is AES-GCM
  wrapped with a PRF-derived key the server doesn't hold.
- MK in transit during provisioning is encrypted with the SPAKE2 session key
  (existing mechanism).
- `POST` must bind `credential_id` to the authenticated user (reject attaching a
  blob to another user's credential). Rate-limit.
- Multiple blobs per credential don't weaken anything — independent wrappings of
  the same MK, as multiple passkeys already were.

## Test plan

- **Unit (Go):** blob insert/list; migration backfill; `POST` authz; dedupe.
- **Integration (Chromium):** Chromium can't reproduce device-specific PRF, so
  simulate **two PRFs for one credential** via the harness (same trick as the
  evalByCredential sim). Cases:
  - registration writes a blob; unlock (try-all) succeeds.
  - a "second device" PRF has no blob → unlock finds none → provision (add-blob)
    path creates its blob → subsequent unlock succeeds.
  - several blobs present → unlock picks the right one via GCM.
  - the add-blob branch does NOT create a new passkey (credential count unchanged).
- **Manual:** real iPhone + Mac end-to-end after rollout.

## Rollout

1. Ship schema + migration (additive; unlock reads migrated blob via try-all). No
   behavior change.
2. Ship try-all unlock + array `GET` + `POST` add-blob + the enrollment add-blob
   branch + the "no blob → provision" trigger. Flag-day is fine (apps1 serves the
   embedded client, so server+client deploy together).
3. Owner provisions the Mac and the iPhone (each pulls MK from a Linux laptop).
4. Verify on real iOS + Mac.

## Resolved decisions

- General per-(passkey,device) blobs, **not** a single canonical passkey. Linux
  untouched; no passkey cleanup required.
- Provisioning is the enrollment flow with an add-blob branch (existing passkey →
  add blob via `get()`; else create passkey as today). Same endpoints.
- try-all decrypt (no per-blob tag in v1).
- Trigger provisioning from a failed unlock (no separate manual step required),
  reusing the SPAKE2 MK transfer.

## Open questions (to work through next)

- **Provision UX/trigger detail:** on a no-blob unlock, auto-navigate into the
  provision flow vs. show a clear "Set up SSH on this device" prompt with a
  button. (Both run the same flow; question is how forceful.)
- Prune a device's blob when a passkey/device is removed?
- When to drop the legacy `encrypted_master_key` column.
