# Pastel concert lighting

Continues the installed Taste skill's app-screen direction: True-black flat, seed 714977732. No redraw: this is an interaction and color pass on the approved signup layout. The prior render is in `../after/`; the new render is in `after/`.

The user's explicit request for pastel concert lights and responsive glows overrides the skill's default ban on gradients/glows. Three decorative radial washes are documented with source exceptions; the browser inspector uses `--allow gradient`. No other rule is exempted. This is a deliberate extension of the direction, not a claim that gradients are normally part of it.

Idea: the light on the attendee's band becomes the page's responsive concert lighting. The screen still answers “What needs to go on my band before I finish registration?” The band preview, its LED, enabled primary actions, and light switch share the active pastel. Inputs, medical information, and document surfaces retain readable neutral backgrounds.

Palette: rose #f4bfd7, ice blue #b7d9f5, mint #bfe6d5, peach #ffd2b3, lilac #d5c5f5. Pointer movement follows the cursor using at most one scheduled animation frame; a deliberate sweep of 90px after 650ms advances the color. Every click/tap advances it and adds an 850ms soft pulse. Color transitions take 700ms. No idle animation loop, layout movement, new dependency, or React rerender on pointer movement.

The Lights button is keyboard accessible and exposes its on/off state. Turning it off removes listeners, cancels pending frames/animations, and hides the light layer. Reduced-motion users get static ambient lighting and instant click-driven color changes: no cursor following, pulse, or animated color transition. Touch scrolling does not drive the effect; taps do. Decorative layers cannot intercept form interaction.

## Visual review

Viewed all six inspector images at 1440, 768, and 390px, and additional click, 320px touch, and reduced-motion screenshots. The layout and type geometry stay aligned with the prior version. The colored wash is most visible around the page margins and band slip; the contact fields keep their dark, stable surfaces. The new light switch fits beside Map and Claims at 320px. No text collisions or horizontal overflow were found. At 320px the band summary naturally wraps; at 390px all contact fields remain in the first screen.

Self-review: design 8.0, usability 8.0, creativity 7.6, content 8.0 → 7.9/10. One round; no layout corrections were needed. The intended visual exception is the background glow itself, explicitly requested by the user.

## Checks

- Taste source lint: 0 FAIL, 0 WARN with the three documented gradient-line exceptions.
- Taste browser inspector: 0 FAIL, 0 WARN with only `gradient` allowed.
- Registration tests: 18 passed, using the existing extended command-line timeout.
- Browser checks cover sweep/click color changes, form draft preservation, toggle cleanup, keyboard toggle, reduced motion, touch taps, and 320px overflow. No console errors.

The sample name Maya Event appears only in the isolated review fixture/browser screenshots. No production identity or backend state is added. To reproduce, temporarily copy `../review-fixture.html` to `frontend/__signup-review.html`, run Vite on port 5176, and execute `node .taste-skill/signup/concert/check.mjs` from the repository root. Remove the temporary HTML afterward.
- Production build/typecheck pass; lint passes with existing warnings outside signup.
