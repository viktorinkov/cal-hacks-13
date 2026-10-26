# DIRECTION SHEET — Dressed as something else
seed 1979268729 · drawn 2026-10-25 · redraws: 3 · sector physical-product · tone bold
Brief: Bandit: an NFC + Bluetooth LED wristband for concerts and big public events; tap to sign up, flashes red and points the crowd away when someone falls, finds who you met, makes merch after

| | |
| --- | --- |
| Direction | Dressed as something else |
| Hero | Counter object, wide wordmark |
| Type | Epilogue |
| Colour | Post red, mustard |
| Sections | how-it-works (Itinerary on a slip) → showcase (Two objects, two fields) → stats (One figure owns the screen) → gallery (Full-bleed sequence, text interlocked) → cta (One word is the button) → footer (Contact as the headline) |
| Motion | Slow crossfade |
| Photographs | the "Hands and making" set, as atmosphere |

This is the direction for this build. Adopt it. Do not blend it with the layout you would have made anyway,
and do not redraw because it is unfamiliar: unfamiliar is the point. Redraw a slot only when it conflicts
with a stated brand constraint or needs an asset that does not exist, and say why in your report.

The parts of this sheet were written separately and will disagree in small ways. Settle every disagreement in this order:
**house rules** (including type no smaller than 13px and body text of 16px or more) → **the direction** (the idea, the composition habits, where the
one accent goes) → **the type system and the palette** (which face does which job, the five size steps, which colour is the ground and where the
accent goes) → **the hero blueprint** → **the section blueprints**. Under each blueprint below, "Adjusted for this page" lists where it disagrees.
In practice: take geometry from blueprints (columns, proportions, what sits where) and take everything else from above them. Map every size a
blueprint names onto one of your five type steps instead of adding a sixth. Use one button shape, one corner radius and one pair of page margins on
the whole page, whatever individual blueprints say. If a blueprint names a kind of typeface (a light serif, a heavy grotesk), use the dealt face.

## 1. The idea
Art-direct the subject as if it belonged to a different, more vivid category. A money app is sold like a streetwear drop. An industrial roaster is presented like a design object. Drilling hardware gets the calm of a watch brand. A parcel-locker service becomes a fairground of stickers. Choose the borrowed category by asking what feeling the audience is missing from this kind of product (swagger, calm, glamour, play) and which category owns that feeling. Then take its manners completely: its type, its pacing, its way of photographing things. The contrast between dull subject and vivid dress is what people remember.

Before anything else, write one sentence in your notes: "On this page, <the subject's own material> becomes <the device>."
Fill the first blank from your inventory of what only this client has (its name and what it means, its street, its numbers, its
constraint), then put the nearest competitor in the sentence: if it still works, the idea is the category's, not the client's.
Then name the one live thing the visitor can do on the page (SKILL.md step 4).

## 2. Composition
Depends on the borrowed category, so decide it explicitly and write it in your notes. Fashion drop: one shouted condensed headline across the full width, a single cropped image under it, then product facts as a blunt list. Watch or perfume: a centred object on a dark field, a small serif name, very few words, long vertical pauses. Poster or zine: flat colour blocks, heavy type, tilted cut-out images. Museum: one item per screen on a plinth-like band of colour with a short label beside it. Whichever you choose, the page structure stays simple (four to six sections) and every section uses the borrowed manners, including pricing and the footer.

## 3. Type — Epilogue
A broad black grotesque with a slightly uneven rhythm, at its best as a name set very large in mixed case. Suits entertainers, podcasts, consumer apps and blunt SaaS pages; emphasis comes from colour, not from a change of weight.
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;900&display=swap" rel="stylesheet">
```
- Display: **Epilogue** — weight 900 · tracking -0.04em · leading 0.9 · sentence case or title case
- Text: **Epilogue** — 400 for body, 500 for emphasis · leading 1.5 · tracking 0
```css
:root {
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem);
  --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-lead: clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem);
  --step-head: clamp(2.5rem, 1.2rem + 5vw, 5.5rem);
}
```
The borrowed category's type, fully committed: condensed and loud, or refined and small. No halfway.
The direction decides sizes and how many of them; the type system decides how this face is set. Where the two give different tracking or leading, use the values of the type system: they are tuned to this face.
The display size itself comes from the hero blueprint below.

## 4. Colour — Post red, mustard
```css
:root {
  --bg: #e2dccf;
  --surface: #d7d0c1;
  --ink: #2a1110;
  --muted: #6b524c;
  --accent: #4a6f84;
  --accent-ink: #ffffff;
  --field-1: #dc1928;  --field-1-ink: #ffffff;
  --field-2: #952625;  --field-2-ink: #ffffff;
  --field-3: #e0a912;  --field-3-ink: #2a1110;
  --field-4: #4a6f84;  --field-4-ink: #ffffff;
  --field-5: #e2dccf;  --field-5-ink: #2a1110;
}
```
Post red and bone alternate as full section fields, with red holding the opening and the close. Mustard, slate blue and maroon are kept for whole card frames, and slate blue also fills the one button.
The borrowed category's palette, which will be unlike the subject's sector norm. That mismatch is intended.

## 5. Imagery
**Use the images that belong to the project in every picture slot.** For slots they cannot fill, real pictures of the subject's world from the open collections come next (start with `node /Users/elai410/Projects/cal-hacks-13/.claude/skills/design-taste-frontend/scripts/assets.mjs "wristband"`, then queries from your inventory (its street, its materials, its trade's tools and history); credit them on the page), then the dealt photographs.

Photograph the subject the way the borrowed category would be photographed. With the dealt set, choose images for attitude, not literal relevance, and crop them hard.

**Floor (the inspector checks it):** at least four real pictures on the page, usually six to twelve; SVG drawings do not count. One moving picture where an honest clip exists: `node <skill>/scripts/assets.mjs --video "<query>"`, used as a muted loop with a poster frame. Whatever this direction says about pictures, it is carried out with real ones.

Photographs dealt for this build, from the "Hands and making" set (hands at work, craft and making)
Order of preference for imagery: (1) the project's own photographs and product shots; (2) images you generate, if an image tool is
available; (3) real pictures of the subject's world found in the open collections (assets.mjs, downloaded and credited on the page);
(4) drawings of the subject in code; (5) these. They are real photographs (Unsplash licence, served by picsum.photos) of places, light and
texture. They are atmosphere, never a stand-in for a specific product, dish, person or interface. List the ones you use in your report so
they can be replaced.
- `https://picsum.photos/id/407/1600/1000` — Hands lighting a sparkler that throws bright sparks in the dark · dark tone · charcoal, warm white, amber · calm area: right · native landscape · photo: Kelley Bozarth
- `https://picsum.photos/id/319/1600/1000` — Hands holding a vintage rangefinder camera against a denim jacket · mid tone · denim blue, mustard, silver · native landscape · photo: Kristian Karlsson
- `https://picsum.photos/id/785/1600/1000` — Two cupped hands holding a pile of green spruce tips · mid tone · fresh green, dark green, warm skin · native landscape · photo: Jean Lakosnyk
- `https://picsum.photos/id/674/1600/1000` — Cupped hands holding a heap of dark blue grapes · mid tone · pale blue, dark purple, tan · native landscape · photo: Maja Petric
- `https://picsum.photos/id/304/1600/1000` — Hand adjusting faders on an audio mixing console · mid tone · warm white, navy, amber · native landscape · photo: Drew Patrick Miller
- `https://picsum.photos/id/1060/1600/1000` — Kettle pouring water over a pour-over coffee dripper on a dark counter · dark tone · dark teal, black, warm brown · native landscape · photo: Karl Fredrickson
- `https://picsum.photos/id/491/1600/1000` — Axe, hammer, pliers and leather gloves laid out on dark wood · dark tone · dark brown, tan, steel grey · native landscape · photo: Todd Quackenbush
The last two path numbers are width and height: request the exact crop you render (`/1200/1500` for a 4:5 portrait, `/2400/1350` for a hero) and
add `?grayscale` to desaturate. Use three to six of them, not all eight. Always set `width`, `height`, `alt` and `loading="lazy"` (not on the hero image).
Other sets that fit this brief: city-night, forest, mountain, water — `node draw.mjs --photos <set>` prints one in full; `--photos list` shows all sets. Taking photographs from another set is your call and is not a redraw; keep them to one light and one treatment.

## 6. Hero — Counter object, wide wordmark
Borrowed from a watch or perfume counter. One flat charcoal field. Centred slightly above the midline, a single low-key photograph of the object about 31% of the viewport wide (columns 5-8), 4:5, its own dark background matched to the field with filter: brightness(0.9) so it sits without a frame. Under it the name runs on one line as an ultra-wide wordmark spanning 72% of the width yet only about 45px tall: an extended face with letter-spacing near 0.6em, or a regular face stretched with transform: scaleX(2.4). Then one centred serif sentence at clamp(24px, 2.6vw, 38px). Then a single centred row at 15px with 48px between its three parts: one specification, the price inside the one solid light rectangle that is also the action, a second specification. The wordmark repeats small top-left and one text link sits top-right, both on 32px margins. The bottom fifth and both outer quarters of the screen stay empty and dark.

On a phone: The photograph grows to 70% of the width at 4:5, its top at 16% of the height. The wide wordmark spans the full width inside 20px margins at about 28px tall. The serif sentence sets at 6vw on two lines. The row stacks into three centred lines with the action in the middle at full width. The lowest sixth of the screen stays dark and empty.
Headline: The name as a very wide, very low wordmark on one line (up to 12 characters); the serif sentence beneath is the supporting line, up to 40 characters.

Adjusted for this page:
- It names a kind of typeface: use the dealt faces (display Epilogue, text Epilogue) and their settings; capitals only where the type system sets them.
- It sets a sentence large over several lines: jurors read that as a long headline. Either cut it to a two-line headline at display size, or keep it a statement at 36px or less on three lines (24px, four lines on a phone).

## 7. Sections, in order
Each is a composition to rebuild with this project's content. Keep the geometry; change the subject. Re-order or drop a
section when the argument of the page needs it (see references/copy.md), never to fall back to a card grid.

### 1. how-it-works — Itinerary on a slip (table)
The process is printed as an itinerary or receipt. One paper-coloured slip 420–480px wide stands on a contrasting flat ground at columns 7–11; its bottom edge is a zigzag cut with clip-path and its top edge is straight. The heading, two to four words at clamp(40px, 4.4vw, 68px), sits in columns 1–5 with a 30ch paragraph, top-aligned with the slip. On the slip, in the text face at 16px with tabular figures: stages grouped under time headings that carry the order ('Monday', 'Midweek', 'Friday'), each heading in bold with 28px above it. Under a heading, two to four rows; each row has what happens on the left, a duration or time on the right, and a leader of round 4px dots between. The final row is inverted, paper-coloured text on a full-width ink bar 44px tall, and states the result: what the reader holds at the end and the total time.
On a phone: The heading and paragraph come first. The slip follows at full width minus 16px margins, keeping its zigzag bottom edge. Rows keep left text, dots and right value on one line; long descriptions wrap under the left text. The inverted final row stays full width.

### 2. showcase — Two objects, two fields (split)
Two panels side by side, each 50vw wide and 92svh tall, in two different flat tones from the palette, meeting on a clean vertical edge with no gap. Each panel is dominated by one cut-out object photograph scaled to 130–150% of the panel's width and positioned so the panel's top edge crops it: the reader sees the lower two-thirds of the object, very close. On light panels use mix-blend-mode: multiply to lose a white studio background. Along the bottom of each panel, 28px in from the edges, one row: the name at 20px medium and a price or fact at 17px on the left; on the right, two small rectangular actions, one filled with ink and one with paper. Nothing sits in the middle of a panel. The heading, two to four words at 32–40px, is set at the top-left of the first panel only, in the empty corner beside the object.
On a phone: Panels stack, each 78svh tall, the object scaled to 150% of the width and cut by the top and right edges. The bottom row becomes two lines: name and fact, then the two actions side by side at full width. The heading sits top-left on the first panel at 26px.

### 3. stats — One figure owns the screen (statement)
One number, one screen. A flat field at least 90svh tall. At the top-left, starting on the page's main axis, a one-line claim of two to five words at 36–44px: this is the heading. Then a long gap of 22–28vh. At the bottom-left on the same edge, a single figure at clamp(180px, 23vw, 380px), leading 0.8, tight tracking, with its unit (a percent sign, 'x', 'hrs') set as a superscript one third of the figure's size and aligned to the figure's cap height. Directly beneath, flush with the figure's left edge, a caption of three lines at 16–17px, 32ch wide, saying exactly what was measured and when. The right half of the field stays empty; resist filling it. The figure is static text in lining numerals and does not animate. A source line, if needed, sits at the bottom-right at 15px.
On a phone: The claim sits at the top at 28px. The figure is 46vw, flush left, with its superscript unit; if it has four characters or more, drop it to 34vw so it stays on one line. The caption follows at 16px across 80% of the width. Minimum height 80svh.

### 4. gallery — Full-bleed sequence, text interlocked (full-bleed)
Three photographs, each 100vw by 100svh, shown one after another with nothing between them. Each is `position: sticky; top: 0` inside a wrapper 300svh tall, so the second slides up over the first and the third over the second like a curtain; no scroll hijacking. The section above interlocks with the first photograph: a narrow paragraph at 13–14px, 220px wide, sitting on the column line at 58% of the width, is pulled down with a negative bottom margin so its last four lines overlap the photograph's top edge, in a colour that reads on both ground and image. Each photograph carries one caption line at 15px in white at the bottom-left margin, over a neutral dark scrim limited to the lowest 120px. No heading. Choose three frames with the same light and a calm lower-left corner. The last photograph releases into the next section.
On a phone: Each photograph is 100vw by 88svh in a portrait crop and still sticks so the next covers it. The interlocking paragraph sits at the left margin, 60% wide, overlapping the first photograph by three lines. Captions stay bottom-left at 14px.

Adjusted for this page:
- It names colours (white): map them onto this palette's roles (ground `--bg`, panels `--surface` and the fields, text `--ink`/`--muted`, the accent `--accent` on the primary action only).
- It pins something for three screens or more: hold a pin for two or three screens at most, give every screen under it its own content, and let nothing pass over the pinned words (the inspector checks all three).

### 5. cta — One word is the button (band)
The entire band is one link. A full-bleed field in the accent colour, about 60svh tall, contains a single verb of four to eight letters set at 24–30vw in the heaviest weight, tight tracking, sized with `clamp()` so it spans the content width on one line with its baseline 24px above the bottom edge. The `<a>` wraps the whole band; on hover and focus the field and the word swap colours instantly. In the top-left corner, at 20px, one sentence says what happens next; in the top-right, an arrow drawn as a simple inline SVG, 48px, points up and right. There is no other button anywhere in the section. In a page with a motif, the band's top corners take the motif's shape (a large radius, or a chamfer cut with `clip-path`). Keep the word honest: the action itself, not a slogan.
On a phone: The band is 46svh tall. The word is set at whatever size fills the width on one line; choose a shorter verb rather than going below 22vw. Sentence top-left at 17px across two lines, arrow top-right at 32px. The whole band stays tappable.

### 6. footer — Contact as the headline (statement)
A full-bleed field in one saturated palette colour, at least 90svh tall. Top row, 40px from the edge: two or three short notes at 15px in columns 1–7 (address, hours, a one-line description) and a back-to-top text link at the right margin. Then a tall empty gap. In the lower half, the way to get in touch is the display line: the telephone number or the email address itself, set at 8–9vw, flush left, hard against the margin, as one link. An email address may break once, before the @, giving two lines. Size it with `clamp()` so the longest line fills at least 80% of the width. Under it, one row of small text at 14px spread across three positions: links at the left, credits in the centre, city and year at the right. The wordmark appears only small, in the top row.
On a phone: Notes stack at the top at 15px. The contact line sits in the lower half at 12vw; a telephone number stays on one line, an email breaks before the @ and is sized so each half fits the width. The meta row becomes three stacked lines at 13px.

## 8. Motion — Slow crossfade
The principal photograph quietly changes: three or four images of the same framing crossfade over about 1.6 seconds, holding five to six seconds each, or the fixed image changes when its matching section arrives. It should feel like light shifting in a room. Pause when the tab is hidden; under reduced motion show only the first image.
This is the signature move, the one loud moment. Around it the page still needs the rest of the motion layer (SKILL.md step 9): an entrance for the parts of every section, feedback on every control, and one moving picture. The inspector fails a page that barely moves. Recipes: references/motion.md.

## 10. Where the richness comes from
Attitude. The page has a recognisable voice from another world, applied to a subject nobody expected it for.

## 11. How this direction goes wrong
Name the borrowed category in one word before you start, or the result is merely loud. The content must still be clear: what it is, what it costs, how to get it. Avoid borrowing from 'tech startup', which is the default you are escaping.

## 12. Real references
Studied sites that work this way. Take the principle, never the specifics: no names, copy, images or signature assets of theirs.
- **SSTR - Friction Reduction** (Awwwards Site of the Day, studied score 7.7) `aww-sstr-friction-reduction`
  Idea: Drilling hardware treated like precision consumer tech: a chamfered octagon taken from the tool's cross-section drives the buttons, icons and loader.
  Hero: The captured first viewport is the preloader: a 2 by 2 grid with hairline dividers, top-left quadrant solid orange with the slash-prefixed name at 5.6vw in black bold grotesk; top-right dark with a plus-sign dot grid and an orange square beside a percentage; bottom quadrants hold wireframe octagon stacks under small labels. The real hero is a full-bleed grey 3D render of a steel downhole tool rising from bottom centre. A two-line uppercase headline at about 3.5vw in light grotesk sits left-anchored at mid-height, with a short paragraph and an orange chamfered-corner button below. A slim bar holds logo left, five small caps links, globe and contact right.
  Worth taking: Derive one shape from the product (here a chamfered octagon) and reuse it for button corners, icons and loader graphics.
- **Moto Finance** (Awwwards Site of the Day, studied score 7.3) `aww-moto-finance`
  Idea: A metal card presented like a museum piece: lit by a single overhead light box in a black room, then orbiting through dim architectural stills.
  Hero: Black full-bleed 3D scene. A pale silver-lavender light panel, a trapezoid in perspective like a ceiling light box, occupies the top 20% and centre 55% of the viewport. The two-line uppercase headline, centred at 4.4vw in medium grotesk with tight leading, straddles the panel's lower edge so its first line sits half on light, half on black. In the exact centre a small metal card stands on a low plinth, only about 150px wide, surrounded by darkness. A light-grey pill button (about 250 by 52px) is centred near the bottom; the logo is top-left and a dark pill button top-right.
  Worth taking: Let a headline straddle the edge of a light shape so one line is half on light and half on dark.
- **Ciao Energy** (Awwwards Site of the Day, studied score 7.6) `aww-ciao-energy-launch-website`
  Idea: The can is the whole website: one fixed real-time 3D studio scene in which the camera travels from a flavour carousel to extreme close-ups of the can's own label, where each claim is paired with the ingredient that was taken out, and the copy is a thin layer over the product.
  Hero: A fixed full-viewport 3D canvas on a dark grey studio floor fading to black over the top 40%. A metallic can stands dead centre (about 16% of the width, half the height), tilted about 10 degrees, between a chrome ring hovering above and a dark plinth below; six darker, smaller cans recede on a shallow arc behind it, the outer two cut by the viewport edges. The flavour name sits on the plinth in two lines of heavy italic uppercase at about 36px, over a 480px slider and a small scroll prompt; thin chevrons about 140px either side of the can change flavour. A centred logo about 125px wide at the top, a sound toggle left, a white contact pill right. No headline: the benefits arrive one scroll later.
  Worth taking: For a single physical product, keep one fixed full-viewport render and move the camera, never the layout: beats of about 1.25 viewports, each with its own angle, plus real DOM text so a slow GPU or a failed WebGL context still shows every claim.
Full notes on any of them: `node draw.mjs --site <id>`.

## Always
Headlines two lines or fewer at every width. No eyebrow labels, no monospace, no 01/02/03, no thin rules, no gradients, no shadows at rest,
no cream-and-terracotta, no violet. The frame: one h1 on the first screen that says what this is, equal outer margins, no
section huddled on one side with the other half empty, no blank stretch over half a screen, a heading on every section.
`inspect.mjs` measures all of it.

Saved to /Users/elai410/Projects/cal-hacks-13/.taste-skill/home/direction.json · reprint with `node draw.mjs --show`
