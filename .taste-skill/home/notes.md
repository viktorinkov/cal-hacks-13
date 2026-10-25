# band1t.vip home page

Reading of the brief: the public front door of BandIt at https://band1t.vip/. It must say what the band is,
let a visitor try it without hardware, and send staff to the organizer portal. Edward's asks: a typed
"Bandit / The only band you need" that fills the screen and then moves up, concert lights that pulse harder
and ripple under the pointer, the band photo as a PNG under a spotlight that turns on after the typing, the
band spinning with the scroll, and more interaction.

## Inventory

1. The name: Bandit, written band1t at the address. "The only band you need": band is the wristband and the act on stage.
2. The object: black silicone strap, round puck, a ring of 12 frosted lights, one button in the middle, NFC tag, Bluetooth.
3. The ritual at the door: you get the band with your ticket and tap it to your phone; the tag opens band1t.vip/t/<code>.
4. What goes on it: contacts, medical history, insurance, a wallet (Capital One Nessie sandbox).
5. A fall: every band around the person flashes red and buzzes; the ring points people the way to step back so nobody is crushed.
6. Smoke or low light: the lights walk people to the nearest exit. A paramedic coming in: the rings point how to clear a lane.
7. The numbers in the brief: 44,500 preventable deaths and 15.6 million injuries a year in public venues; 34% from falls. 1,500 people on the demo floor. Bands report every 2 seconds.
8. Cameras and bands together make a space-time map of the floor.
9. After the show: a recap link with where you stood, the booths you visited and the socials of the people you were next to; every event photo is matched to the bands in it.
10. Merch made after the night from your own photos: tee, mug, "My night at Cal Hacks" poster, booth-crawl poster (real templates in assets/merch).
11. The place and date: Cal Hacks 13, San Francisco, October 2026 (printed on the merch templates).
12. Test bands without hardware: AJMN-676X, 1WSV-45SM, YBB1-65TV.
13. The team: Edward, Leo, Luke, Viktor.

## Direction

Dealt `borrowed-category`, seed 1979268729. Chosen over `sentence-as-layout` and `one-motif` because the
name is a pun on a music act: the page can sell the wristband the way a headline show is sold.

Borrowed category in one word: **headliner**. Manners: a black stage, one spotlight on the act, a ticket
stub, stage times, a crowd, a gig poster's flat red and bone, a merch table, the encore.

Redraws:
- palette: Sky and navy fights a night stage under concert light. Redrawn once to "Post red, mustard".
  Kept its proportions (two flat fields alternating, red holding the opening chapter and the close) and took
  the colours from the band itself: black silicone stage, frosted-light bone, the alert red, the ring's LED
  green as the one accent (on the action).
- gallery: briefly swapped to list-sticky-photo-active-list by mistake, then restored to gallery-full-bleed-sequence.
- Added a seventh block for merch using `list-sticky-photo-active-list` geometry from the alternatives (the
  brief's "Shopping" chapter has no dealt section and four real products).

Deliberate departures, each from Edward's brief:
- Typing animation on the title (the house bans typewriter text). Kept short (under 2 s), the real words are
  in the HTML from the first frame, any key, click or scroll finishes it, and reduced motion skips it.
- Concert light, spotlight and haze are drawn as light in a WebGL canvas (gradients and glows by nature).
  No CSS gradients anywhere else.
- The hero's wordmark is very large instead of the blueprint's low wide wordmark, because Edward asked for
  big letters that fill the screen and then rise.

## The idea

On this page, **the band's ring of twelve lights** becomes **the stage lighting**: the light over the crowd,
the spotlight on the headliner and every chapter are driven by what the ring does on the night (white when you
tap in, red when someone falls, a green arc that points the way out).

Competitor test: another festival wristband (an RFID entry band) has no ring of lights that points; the sentence breaks.

Live thing: the crowd under the stage is a field of bands. Move through it and the bands light up in rings
behind the pointer; click or tap anywhere in it and someone falls there: the bands around that spot flash red,
the crowd steps back from it, and the headliner's ring turns red and then points away from the fall.
Phone: tap. Without script: the stage as a still picture.

## Argument

hero: Bandit, the only band you need: a wristband for concerts and big events → the band under a spotlight, the crowd of bands, one action (try a test band).
night: Everything it does happens in one night, from the door to the morning after → the ticket slip with stage times.
safety: When someone falls, the bands near them flash red and point the way to step back → the band itself, red and green, with the buttons that trigger it.
why: Falls are where crushes start → 34%, one figure.
crowd: It is built for the front of a full floor → three full-bleed photographs of real crowds.
after: The night comes home with you, printed → the merch table, four real products with the night's photo in them.
cta: Try it now with a test band → one word, the whole band a link.
footer: Run an event? The organizer portal → the address as the display line.

## Copy deck

Header: Bandit · The night · Safety · Merch · Organizer sign in

Hero
h1: Bandit / The only band you need
lead: A wristband for concerts and big events. Tap it to check in. If someone falls near you, it flashes red and shows you which way to step.
row: NFC and Bluetooth · [Try a test band] · 12 lights, 1 button
hint: Click the crowd to see a fall. (phone: Tap the crowd to see a fall.)

The night
h2: One night, one band
p: You get it at the door with your ticket. After that, everything it does is a tap, a light or a buzz.
Slip:
Doors, 7:00 PM
  Tap the band to your phone .......... 10 sec
  Add contacts, medical card, insurance .......... 2 min
  Load the wallet for drinks and merch .......... 30 sec
The show, 8:30 PM
  Bands find each other over Bluetooth .......... every 2 sec
  Cameras and bands map the floor .......... live
  Someone falls: the bands around them flash red .......... at once
  Every ring points the way to step back .......... until it clears
After the encore, 11:30 PM
  Find the people you stood next to .......... next morning
  Every photo you are in, tagged .......... next morning
  Merch printed from your night .......... your pick
Final row: You leave with the people you met .......... one band

Safety
h2: When someone falls
Left panel (red): name "Red ring" · "Every band within a few metres flashes red and buzzes, so the people around stop pushing." [Someone falls] [All clear]
Right panel (bone): name "Green arc" · "The ring points away from the fall, toward open floor. In smoke it points to the nearest exit." [Smoke] [Medic coming]

Why
h2: Falls start the crush
figure: 34%
caption: of the 15.6 million injuries at public venues each year begin with a fall. In a packed crowd, one fall is how a crush starts.
source: Figures from the BandIt research brief, Cal Hacks 13.

Crowd
h2: The front of the crowd
p: It is built for full floors: a barrier, a few thousand people, lights in everyone's eyes and no phone signal.
captions: (what each photograph shows, place and year)

After
h2: After the encore
rows: Tee · Mug · My night poster · Booth crawl poster, each with a description and price (sample prices).

CTA
sentence: No band on you? Try one of ours. It opens the same sign-up a tap does.
word: Tap in

Footer
notes: Bandit is a wristband for concerts and big public events, made at Cal Hacks 13. · Every band's tag opens band1t.vip/t/ and its code. · Back to top
display: band1t.vip/organizer (link)
meta: Organizer portal · Photographer upload · Code · Devpost | photo credits | San Francisco, October 2026

Sample details to confirm: stage times, durations on the slip, merch prices, the 34% / 15.6 million figures (from the README, unsourced).
