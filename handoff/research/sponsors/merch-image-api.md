# Merch mockup images: which API (CalHacks 13.0)

*Researched Oct 24, 2026. Covers the image step of [Merch](../system-design/Merch.md) and the checkout on the post-event recap page.*

## TL;DR

- **No sponsor is a strong fit.** No anchor, gold, silver or bronze sponsor runs an image-generation track. The only image-capable option tied to a prize is the Gemini API, through **MLH "Best Use of Gemini API"** (swag kits). Bitdeer AI Studio advertises image generation but names no models; Runpod is GPU hosting with no prize; Adobe, Canva and Figma have no image API track.
- **Use Gemini anyway, on merit: Nano Banana 2.1 (`gemini-nano-banana-2.1`, stable).** It keeps up to 4 people consistent from up to 14 reference images, runs in about 30 s for roughly $0.08 an image, and is a plain REST call. In a May 2026 face-consistency test its predecessor matched FLUX.2 and gpt-image-2 on keeping the face, at about 7x the speed and a third of the cost of gpt-image-2. The MLH Gemini submission comes free with it.
- **Never let a model redraw the photo that gets printed.** The shirt print is the real photo, composited in Rust as Merch.md already plans, so faces are exact. Gemini adds the "memory" images on top: an illustrated version of the photo, and the attendee wearing the shirt.
- **Generate everything after the event and before the email goes out.** In Viktor's flow nobody waits on a render, so 30 s per image does not matter.
- **Nessie is the right checkout.** Keep it.

## Comparison

| Option | Keeps the real face | Puts it on a garment | Speed | Cost | From Rust |
|---|---|---|---|---|---|
| **Gemini Nano Banana 2.1** (pick) | Good; up to 4 people; small details can drift (a test turned a tattoo abstract) | Good at "this person wearing this shirt" and at blending a photo with a garment reference | ~30 s | ~$0.08 | JSON `generateContent` with base64 images; `reqwest` + `serde` |
| Gemini Nano Banana Pro (`gemini-3-pro-image`) | Best Gemini; up to 5 people | Best composition | ~26–34 s | ~$0.15 | same call |
| OpenAI gpt-image-2 ("ChatGPT") | Good with `input_fidelity: high`, but only the first input image gets full detail, so faces must be merged into one image first | Good; supports masks | ~212 s in one test | ~$0.22 | multipart `POST /v1/images/edits`; `async-openai` crate |
| FLUX.2 pro (BFL, fal) | Best in the May 2026 test | Good multi-reference | ~30 s | ~$0.135 | REST, then poll |
| Printful mockup API | Exact (no AI) | Photoreal blank garments | async, seconds | free with an account | REST; needs a Printful store and token |
| Rust composite (already designed) | Exact | Flat print area on a product image | under 1 s | free | already in `bandit-workers` |

Gemini wins on speed, cost, group photos and Rust simplicity. gpt-image-2 is the fallback if Gemini refuses a photo. Printful is skipped: it adds an account and a dependency to get fabric folds the judging run doesn't need.

## How it fits the recap flow

1. **Event ends.** Enqueue one `merch_design` job per attendee from their confirmed, merch-consented photos (consent rules unchanged from Merch.md).
2. **Brief.** Claude picks 1 to 3 photos and writes the brief, as today.
3. **Render (`merch_render`), three images per suggestion:**
   - *Photo tee:* the real photo in a template, composited onto the product image in Rust. Exact faces, always ships, and doubles as the no-AI fallback.
   - *Illustrated tee:* Gemini restyles the photo into a screen-print graphic with the event name and zone, then Rust composites it the same way. Stylized art tolerates small face drift.
   - *Memory shot:* Gemini gets the attendee's photo plus the flat photo-tee mockup and returns them wearing that shirt at Cal Hacks. This is the image the email and the recap page lead with.
4. **Email.** Send the recap link once every suggestion is `ready` or `fallback`.
5. **Buy.** At the bottom of the recap page, `place_merch_order` starts a payment with `confirm_mode` `app`, the attendee taps confirm, and the worker records the Nessie purchase (Payments-Nessie.md already designs this).

Rough cost for the judging run: 3 images × 2 AI calls ≈ $0.50 per attendee, so about $25 for 50 test attendees.

## Calling Gemini from Rust

Add a `gemini-client` crate next to `claude-client` and `nessie-client`, used only by `bandit-workers`.

```
POST https://generativelanguage.googleapis.com/v1/models/gemini-nano-banana-2.1:generateContent
x-goog-api-key: $GEMINI_API_KEY
Content-Type: application/json

{"contents":[{"parts":[
  {"text":"This exact person wearing the t-shirt from the second image, at a hackathon at night. Keep their face unchanged."},
  {"inline_data":{"mime_type":"image/jpeg","data":"<base64 photo>"}},
  {"inline_data":{"mime_type":"image/png","data":"<base64 flat mockup>"}}
]}]}
```

The image comes back base64-encoded in `candidates[0].content.parts[].inlineData.data`. REST responses use camelCase, so add `#[serde(rename_all = "camelCase")]`. Downscale photos to about 1024 px before sending. Treat a response with no image part as a refusal and fall back to the photo tee.

## Is Nessie the right checkout?

Yes.

- It is the Capital One track: $1,200, plus a $300 Giftogram per team member.
- It is already designed for exactly this case: `confirm_mode` `app` after the event, with the merch hook in `settle_payment`.
- It is a sandbox, so no card form and no real money. Every attendee already has a sandbox account from sign-up.

One piece is missing: **the email link has to sign the attendee in.** `confirm_payment` must run as the paying attendee's own identity, so the link needs a one-time token that maps to their SpacetimeDB identity.

The bigger prize for this flow is **Visa "Reimagining Shopping" ($5,000)**, which lists no API requirement and is already mapped to Merch in Architecture.md. The pitch is merch made from your own night, generated for you and bought from your recap. Nessie and Visa don't conflict.

## Doc impact

Merch.md and Anthropic-Agent.md say Merch "does not generate images with AI" and that "no social or merch job sends pixels." Both need a short edit: add the Gemini step to `merch_render`, add the `gemini-client` crate, and add "Gemini refuses or fails → photo tee only" to the failure table. Sending photos to Google is a new data flow, so the `merch` consent text should say that photos are sent to an AI image service.

## Sources

- [Cal Hacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/) (sponsors and prizes)
- [Gemini Nano Banana 2.1 model page](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1), [Gemini image generation docs](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Character consistency test: Gemini vs OpenAI vs FLUX vs Runway, May 2026](https://techstackups.com/comparisons/gemini-vs-openai-vs-flux-vs-runway-character-consistency-may-2026/)
- [OpenRouter: gemini-3-pro-image](https://openrouter.ai/google/gemini-3-pro-image), [fal: best image-to-image APIs 2026](https://fal.ai/learn/tools/best-image-to-image-apis-2026)
- [OpenAI cookbook: high input fidelity](https://developers.openai.com/cookbook/examples/generate_images_with_high_input_fidelity), [Azure: gpt-image-2](https://ai.azure.com/catalog/models/gpt-image-2)
- [Printful API v2 docs](https://developers.printful.com/docs/v2-beta/), [Bitdeer AI Studio](https://bitdeer.ai/en/playground)
