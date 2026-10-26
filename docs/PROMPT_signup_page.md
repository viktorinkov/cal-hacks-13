# Prompt for the coding agent: band sign-up on /register

## Context

The frontend (`frontend/`, React 19 + Vite + Tailwind, SpacetimeDB client in `src/stdb/session.ts`)
already has a first sign-up at `/register` (`src/components/join/RegisterPage.tsx`, linked from
`JoinPage.tsx`). Today it:

- lets the user pick any band from a dropdown of `MOCK_BANDS`, and silently falls back to
  `band-01` when the URL has no band (`bandFromLocation`);
- asks for medical and insurance details as typed text boxes;
- takes card brand, last four and expiry;
- saves everything to `localStorage` (`src/cover/registry.ts`) and calls `registerBand`, which runs
  `claimBand({ token: 'BANDIT-<label>' })`, `updateProfile`, then `connectWallet`.

Rework this page (keep the `/register` route, `NightHeader`, `CoverSlip` and the page's look) so
that:

1. the band is the one the user tapped, not one they pick;
2. insurance and medical history are **uploaded documents** read by the backend, not typed boxes;
3. payment stays a mock card form.

## 1. Band assignment from the NFC tap

- Tapping a band opens `/register?band=band-05` (or similar). Read the band from the URL only.
- **Remove the band dropdown** and the `band-01` fallback. With no or an unknown `band` param, show
  a short "Tap your band to start" screen instead of a form.
- Show which band they're on ("You're on band 05") at the top of the form.
- Claim it with the existing `claimBand({ token: 'BANDIT-<label>' })`. If the reducer refuses
  (already claimed by someone else, unknown token), show its message in the form error slot and
  don't continue.
- After claiming, read the `my_band` view (`band_id`, `status`, `expires_at`) to confirm the band is
  theirs, and show its status. If the user already holds this band, open the form in edit mode
  rather than re-claiming.

## 2. Insurance and medical uploads

Backend pieces that already exist (check `src/stdb/module_bindings/`):

- `register_blob({ hash, owner, access, purpose, contentType, sizeBytes })`
- `submit_medical_document({ kind, fileHash, pageCount })`
- view `my_medical_documents` (`kind`, `file_hash`, `status`, `job_id`, `dropped`, `uploaded_at`)
- view `my_medical_card` (blood type, allergies, conditions, medications, emergency contact,
  insurer, plan, member id, group number, insurer phone, `status`)
- `confirm_medical_card({})`

What to build:

- Two upload areas: **Insurance card** (front and back, image or PDF) and **Medical history**
  (PDF or images, several files allowed). Accept `image/*` and `application/pdf`, with a size cap
  (start at 10 MB per file) and a clear message when a file is rejected.
- For each file: hash it in the browser (SHA-256 via `crypto.subtle`), upload the bytes to the
  backend's blob storage, then call `register_blob` and `submit_medical_document` with a `kind`
  that says which upload it is (e.g. `insurance_card`, `medical_history`). Count PDF pages if it's
  cheap; otherwise send 1 for images.
- **The byte-upload route is not in this repo.** Find it in the backend module (or ask) before
  writing it. Put it behind one function (e.g. `uploadBlob(file): Promise<{ hash }>` in
  `src/stdb/`), and don't invent a URL. If no route exists yet, stop and report that rather than
  storing files somewhere else.
- Show each document's live `status` from `my_medical_documents` (uploading → reading → read /
  failed), with a retry for failed ones. Show the `dropped` list if the extractor dropped fields.
- When `my_medical_card` is filled, show what was read (medical + insurance fields) as a
  read-only review with a **"This is right"** button that calls `confirm_medical_card`. The user
  doesn't type medical facts. Keep only name, email, and emergency contact name and phone as typed
  fields (the extractor may not have them).
- Note from `session.ts`: the wallet and medical-card views "never complete on their own" when
  bundled. Subscribe to `my_band`, `my_medical_documents` and `my_medical_card` **one at a time and
  apart from the floor and staff subscriptions**, so a hang on one doesn't stall the rest. While a
  view hasn't arrived, say "Still reading your documents" rather than showing an empty card.

## 3. Payment (mock)

- Keep the current card brand / last four / expiry fields and their validation (`errorsFor`).
- **Never add a full card number, CVC or any field that could take one.** Keep the "Last four
  only" note.
- Keep calling `connectWallet` after the claim so the wallet account opens. Show the `my_wallet`
  account once it arrives, and don't block sign-up on it.

## 4. Flow and saving

- Order on the page: band (from the tap) → person (name, email, emergency contact) → uploads →
  review and confirm the card → payment → done.
- Done screen: keep the existing "Saved on band NN" screen with `CoverSlip`, filled from
  `my_medical_card` when it exists, and from the local registration otherwise.
- `localStorage` (`saveRegistration`) stays only for the typed fields and the mock card, so the
  demo seeds and the floor tap (`BandTapDialog`) keep working. Don't put uploaded files or their
  contents in `localStorage`.
- Keep `registerBand`'s order (claim → profile → wallet); add new session actions next to it in
  `session.ts` rather than calling reducers from the component.

## Don't touch / constraints

- Don't hand-edit `src/stdb/module_bindings/` (generated). If a reducer you need is missing,
  report it.
- Don't commit `.env`.
- Medical files are sensitive: no logging of file contents or extracted fields to the console,
  and register blobs with private `access` owned by the caller's identity.
- Accessible form: labels on every input, errors tied with `aria-describedby` as the current
  `Field` does, upload areas usable by keyboard, works at phone width (people sign up on the
  phone they tapped with).
- Keep `npm test`, `npm run typecheck` and `npm run lint` passing. Add tests for:
  - the "tap your band" screen when `?band=` is missing or unknown;
  - a claim refusal showing in the form error;
  - file validation (wrong type, too large) and the per-document status display;
  - the confirm button calling `confirm_medical_card`.

## Done when

On a phone-width browser, opening `/register?band=band-05`: the page says band 05, claims it,
accepts an insurance card photo and a medical-history PDF, shows them being read, shows the
extracted card for confirmation, takes the mock card, and lands on "Saved on band 05". Opening
`/register` with no band shows the tap screen. No console errors.
