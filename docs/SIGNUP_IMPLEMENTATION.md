# Signup implementation and backend handoff

The `/register?band=band-05` frontend now uses the tapped band, waits for ownership in
`my_band`, uploads supported PDFs, renders live extraction status and a read-only medical
card, confirms that card, then saves contact details and mock payment information. Opening
`/register` without a known band shows the NFC tap prompt. Returning owners edit without
re-claiming their band.

The page retains `NightHeader`, `CoverSlip`, the Nocturne colors, and Instrument Serif type.
At phone widths the order is band → person → documents → review → mock payment → done.
Name, email, emergency contact name/phone, card brand, last four, and expiry are the only
editable personal fields. Demo seed identities no longer prefill new registrations.

## Verified backend contract

Source inspected in the `vik-e2e` worktree and `origin/main`
(`06a518edee9777f7d65f3f0d00a5a452ce4523fe`), without changing backend files:

- `crates/bandit-api/src/web.rs`: `POST /api/blobs?purpose=insurance|history` accepts raw
  bytes, `Content-Type`, and `x-bandit-session`; returns `hash`, `size_bytes`, `pages`, `url`.
- `web/src/lib.ts`: generate an ephemeral random session secret, SHA-256 hash it, and call
  `openApiSession({ tokenHash })`. Send the original secret in `x-bandit-session`.
- The upload route **already calls `register_blob`**, with the authenticated identity as owner
  and `owner_only` access. Direct attendee calls to that reducer are forbidden by its role
  gate. The frontend hashes the uploaded bytes and checks the returned hash, then calls
  `submitMedicalDocument({ kind, fileHash, pageCount })`. Kinds are `insurance` and `history`.
- PDF page counts come from the upload response. The upload utility uses one page for images,
  but the page currently rejects photos before upload because extraction is PDF-only.
- `spacetimedb/server/src/social/onboarding.rs` and `social/views.rs`: `claimBand` starts an
  eight-second button window; `waiting_for_press` is not ownership. The frontend unlocks
  uploads and saving only when the matching band reports `claimed`. Expired claims can retry.
- The band, documents, medical card, and wallet views each get their own subscription, apart
  from the floor and staff queries. An unapplied medical view stays “Still reading your
  documents,” distinct from an applied but empty view.
- `registerBand` keeps claim → profile → wallet order, skips the claim for the existing owner,
  and reports wallet failure without failing registration. The wallet view can arrive later.

All reducers stay behind `src/stdb/session.ts`; byte transfer is isolated in
`src/stdb/uploads.ts`. Generated bindings and environment files were not edited.

## Backend work required for the full brief

The UI deliberately explains and rejects unsupported image and multiple-file selections
before sending bytes. It currently supports one PDF per section (a replacement PDF may be
uploaded once the prior read completes). Both sides of an insurance card must be combined
in that PDF. These limitations must be removed after the backend supports them:

1. **Image extraction.** `crates/bandit-workers/src/medical.rs` always constructs a PDF model
   request, even when the uploaded bytes are an image. Add MIME-aware image extraction, or
   agree on browser PDF normalization before enabling photo submission.
2. **Multiple documents / front and back.** `spacetimedb/server/src/medical/mod.rs` replaces
   every medical field for a history extraction and every insurance field for an insurance
   extraction. Merge or aggregate same-kind documents with deterministic provenance so the
   final completed job cannot erase other pages' facts. Keep per-document status and dropped
   fields. The current page serializes same-kind submissions while a read is pending.
3. **Terminal job failures.** Exhausted `medical_extract` jobs do not currently update their
   document to `failed`. Publish that state so the frontend can offer retry instead of
   indefinitely showing “Reading.”
4. **Actual private downloads.** Upload metadata is `owner_only`, but `GET /blobs/{hash}` is
   unauthenticated and treats the hash as a secret. Enforce owner/staff authorization on
   sensitive document downloads. This frontend does not expose blob download URLs.
5. **Request size.** The client rejects files over 10 MiB. A matching upload body limit was
   not found in the inspected server; verify/configure it. HTTP 413 gets an explicit message.

Until these are resolved, the photo + multi-document acceptance scenario is incomplete.
The implementation does not store files elsewhere or fabricate extraction results.

## Local persistence

`saveRegistration` uses an explicit allowlist for typed contact fields, mock-card fields,
and existing demo tap accounting. It excludes medical/insurance facts, file bytes, and
extraction data. Reading old registrations scrubs those fields from legacy storage.
`getSavedRegistration` reads only actual saves; `getRegistration` retains in-code demo seed
fallbacks for floor taps. The done screen combines the live medical card with the local
contact/mock-card record in memory.

## Checks

Added tests cover missing/unknown band URLs, claim refusal and physical confirmation,
independent subscriptions, upload validation/authentication/hash verification, document
status and retry, medical confirmation, wallet failure, and storage sanitization. The
live hardware, deployed extractor, and deployed upload body-size limit still need a real
end-to-end check; fixture-based UI tests do not verify those services.

Verification on this branch: 133 tests pass; typecheck, lint, and production build pass
(existing lint and bundle-size warnings remain). Vitest uses one worker because parallel
CPU-heavy simulation suites intermittently exceeded their existing five-second timeout;
no test assertions or timeouts were relaxed. Chromium fixture checks passed at 320px,
390px, and 1440px with no console errors, including review, confirmation, save, and edit.

## Taste redesign

The signup UI now follows the installed Taste skill's app-screen workflow: True-black flat,
seed 714977732, retaining the existing Nocturne palette and font assets. A compact live band
slip replaces the oversized introduction. Section headings and form panels share a consistent
grid that stacks at tablet width, with 44px phone controls and readable disabled states.
The saved screen scrolls to the top and focuses its confirmation heading.

The design direction, before/after screenshots, critique, fixture, and browser check script
are retained under `.taste-skill/signup/`. The temporary fixture was removed from the frontend.
The live backend, PDF-only limitation, and storage rules above remain unchanged.

Redesign verification: 135 tests pass with `npm test -- --testTimeout 30000`; default five-second
runs hit timing failures in the crowd simulation and a user-event signup test. No project timeout
setting or assertions were relaxed. The session test now waits for its required attendee queries
instead of assuming a fixed total subscription count, since venue setup adds more subscriptions.
Taste's source lint and browser inspector report zero failures and warnings. Browser fixtures cover
320px overflow, preview values, confirmation, saving/editing, header navigation, focus, and claim
states with no console errors. Project lint passes with warnings in other existing components.
Production build and TypeScript checking pass. A type-only `Mesh` import fixes two namespace
errors in the current venue viewer; its runtime behavior is unchanged. Existing bundle-size
and shared GLTFLoader import warnings remain.
