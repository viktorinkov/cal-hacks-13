# Signup redesign review

Applied the installed `design-taste-frontend` skill's app-screen workflow. Direction: **True-black flat**, seed **714977732**, with BandIt's Nocturne palette and existing Geist/Instrument Serif fonts retained. One shell redraw replaced the dealt sidebar with the no-sidebar alternative because this attendee flow has only Map and Claims destinations. No dependencies, illustrations, gradients, entrance animations, or production sample data were added.

## Before

The oversized serif introduction competed with the actual registration task. The phone's first input began around y750, after a tall marketing-style sidebar. Tablet retained two columns even when the form became narrow. Numbered headings, tracked uppercase labels, and repeated panel outlines added decoration without helping the attendee finish.

Highest-impact changes: put the band status and task title together; move contact fields into the first phone viewport; replace the narrow right-hand form with full-width settings rows that stack at tablet width.

Self-review: design 6.0, usability 6.0, creativity 5.5, content 7.5 → 6.1/10. These are qualitative design judgments, not user-study results.

## After, round 1

The first screen names the job and shows the tapped band and its live ownership state. A compact band slip previews the same name and mock-card suffix being edited below. The champagne LED and actual band number connect the layout to BandIt. Sections share a 1152px frame and a consistent label/panel grid; at 768px they stack. Phone controls are at least 44px high, and 16px input text avoids automatic input zoom.

Viewed every desktop, tablet, and mobile fold/contact sheet in `after/`, plus the filled preview, medical review, waiting, expired-claim, and saved states. No horizontal overflow was found at 320, 390, 768, or 1440px. The four contact fields fit in the first 390×844 phone screen, with the name input around y498. Flat surfaces separate sections; color is limited to the band LED and status/error information. No chart or numeric aggregation is present. The band number and preview values derive from the same route and draft as the form; no duplicated fact is independently hardcoded. Missing medical values remain explicitly marked “Not found in documents.” The two navigation links fit comfortably on phones without needing a menu.

Round 1 fixes: keep long extracted values inside their grid cells; enlarge the secondary confirmation-screen action's touch target; remove the redundant `box-shadow: none` declaration flagged by the static scanner.

## After, round 2: state transitions

The saved-state screenshot revealed that the inner scroll container retained its form position, hiding the confirmation heading. The saved heading now receives focus and the container scrolls to the top. Browser checks verify both. The final saved screenshot presents the confirmation first, followed by the retained CoverSlip.

The medical card remains a relatively long section on phones, but keeping all extracted facts visible and readable supports the required review. No field is silently collapsed. The document picker is native, keyboard accessible, and preserves explicit rejection messages for currently unsupported photos/multiple files.

Final self-review: design 7.8, usability 8.0, creativity 7.0, content 8.0 → 7.7/10. The distinctive element is the live band slip; the remainder deliberately uses familiar form patterns.

## Measurements and scope

| Check | Before | After |
| --- | --- | --- |
| App inspector | 0 FAIL, 3 WARN categories | 0 FAIL, 0 WARN |
| Source lint | 0 FAIL, 7 WARN | 0 FAIL, 0 WARN |
| Desktop title | 64px serif | 28px Geist |
| Phone title | 42px serif | 26px Geist |
| Phone first input | approximately y750 | approximately y498 |
| Uppercase micro-labels | 2 | 0 |
| Monospace UI accents | present | none |

No inspector allowances were used. The source warning for `box-shadow: none` was a scanner false positive; the unnecessary declaration was removed.

The before inspector captured only the first viewport because the app scrolls inside `[data-page]`. For full after contact sheets, a temporary harness exposed that same component's content to window scrolling without changing its width or spacing. Separate browser checks restored production inner scrolling for focus, saving, and overflow verification. The temporary harness is removed before delivery.

All browser state checks use isolated fixtures and perform no real claims or uploads. Fixture names: Alex Rivera, Sam Rivera; example.test email; fictional Northline insurance identifiers and 415-555 phone numbers; demo card suffix 4242. They exist only in review assets/scripts and must not be treated as production identities. Real byte upload, hardware claiming, and extraction remain dependent on the backend described in `docs/SIGNUP_IMPLEMENTATION.md`.

To reproduce the isolated browser review, temporarily copy `review-fixture.html` to `frontend/__signup-review.html`, start Vite on port 5176, then run `node .taste-skill/signup/check-states.mjs` from the repository root. Remove the temporary HTML after reviewing. That fixture imports the real page and injects only test store state; it never starts the backend session. The retained production changes are the page component and its scoped stylesheet, plus test harness compatibility updates.

## Validation

- `npm test -- --testTimeout 30000`: 135 tests across 22 files passed. Default five-second runs timed out in the CPU-heavy crowd simulation and one user-event signup test; no production timeout setting or assertion was weakened.
- Updated the signup session harness to await the four required independent attendee subscriptions instead of assuming five total subscriptions. Venue setup now contributes additional subscriptions. All six session tests pass.
- Added jsdom's missing `Element.scrollTo` shim for the confirmation transition. Browser assertions verify real scroll position and heading focus.
- `npm run lint`: passes; warnings remain in other existing components.
- Taste source lint and browser inspector: 0 FAIL, 0 WARN. See `after/report.json` and `states/checks.json`.
- Browser fixture flow: live preview, confirmation, saving/editing, navigation, focus, pending/expired claims and errors; no console errors. Real hardware and upload/extraction services were not exercised.
- The build exposed two `THREE.Mesh` namespace errors in the current venue viewer. Added a type-only `Mesh` import and updated those casts; this has no runtime effect.
- `npm run build`: passes, including TypeScript checking. Existing large-chunk and shared GLTFLoader import warnings remain.
