# BandIt signup design direction

Skill: `.claude/skills/design-taste-frontend/SKILL.md`, app-screen run.

## Inventory

- An attendee opens one NFC link on a phone, often at a busy event.
- The URL identifies one of the nine demo wristbands; it is not a dropdown choice.
- The band has a dark strap, a single LED, and a physical confirmation button.
- A claim waits eight seconds for the button and can expire.
- Returning owners edit their existing band.
- The person record has name, email, and an emergency contact and phone.
- Two kinds of documents are read: insurance and medical history.
- The current extractor accepts one PDF per section; photos and merging remain blocked.
- Extraction exposes actual uploading/reading/read/failed states and dropped fields.
- The attendee confirms the read-only medical card before saving.
- Payment is only brand, last four, and expiry; the wallet may arrive later.
- No medical facts or file bytes belong in the browser's stored registration.

Screen question: What still needs to go on my band before I can finish registration?
First finding: the actual band ownership state, with the physical-button instruction when pending.
Blocks: which band is this; whose band is it; what can be read; is the reading correct; which mock card; saved receipt.

## Decision

Dealt: True-black flat, seed 714977732. Chosen because this is a quick attendee task in an event product, rather than a monitoring terminal.
Keep the Nocturne colors and existing Geist/Instrument Serif font assets. Geist handles app content; Instrument Serif is reserved for the BandIt wordmark. Apply the dealt dark tone steps, no panel shadows, legible disabled controls, and neutral inverted actions.
Redraw shell once: the initially dealt T-frame invents a persistent sidebar the existing attendee flow does not have. Use its no-sidebar alternative to preserve NightHeader and the two real destinations.

Face: BandIt's champagne LED on the physical strap, and its verified ownership status.
Signature: a compact live band slip. The actual band number, entered name, and mock-card suffix update from the same draft as the form; it never invents extracted medical values.
Idea: the band the attendee just tapped becomes a live registration slip at the top of the form.
Grid: maximum 1152px; settings row = 264px label column + 24px gutter + remaining 864px panel. At 768px and below, label and panel stack. Phone padding 20px. No empty marketing sidebar.

## Copy deck

Title: Register your band.
Support: Add your details, then check what your documents say.
Band: You're on band NN. Physical state and next action come from the live session.
Your details: The person wearing the band, and someone to call.
Documents: Your insurance card and medical history, read into one medical card.
Review your card: Check the details before confirming them.
Payment: Mock card details for this demo. Last four only.
Done: Saved on band NN. Edit this band / Claims desk.
Empty tap: Tap your band to start. Hold your phone near your band's NFC tag and open the link.

All preview data is explicitly isolated test fixture data. No new production sample identity, numbers, image assets, or dependencies.
