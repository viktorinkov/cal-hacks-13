## What it does

BandIt does four things at a public event. It prevents and handles accidents, settles the insurance claims that follow, connects the people who met, and turns the night into merch you buy afterward.

### Accidents

Falls are the leading cause of injury at public venues, and the biggest danger after a fall is a crowd crush. BandIt works on both. It warns about crowding before anyone falls, and it brings help fast when someone does.

#### Stopping a crush before it starts

Every band counts the other bands close to it and shows the result on its ring of lights. Green means calm, yellow means people are pressing in, and red means move out now. A red ring also has a light that circles in the color of the nearest exit, so a tight spot thins out as people walk toward it. The organizer portal marks every zone calm, busy or very busy from the bands inside it, with the same limits as the rings. A live map shows every band as a dot, so the organizer sees a zone fill up while there is still time to act.

#### Finding the exit

Small radio markers stand at every exit, and each one glows its own color. A band listens for the markers and takes the loudest one as its zone, so the marker it hears best is also its nearest exit. In a fire or thick smoke, people cannot see the exit signs. The organizer presses one button on the portal, confirms, and every band starts to guide its wearer out. Each ring turns red with a light that circles in the color of its nearest exit, the same color as the marker at that door. The circling gets faster as the wearer gets closer to that marker, and bands with a motor add a guide pulse on the wrist. A second button turns guidance off when the danger is over.

#### A fall or an SOS

When a band detects a fall, or its wearer holds the button for three seconds, the ring flashes red four times a second. Bands with a motion sensor detect falls, and those bands also vibrate on the wrist. Every band within arm's reach of the person pulses blue, so the people nearby see that someone next to them needs help and give them room. The red flash and the blue circle stay on top of everything else, exit guidance included. The bands do all of this among themselves, with no internet and no server. Moments later the alert reaches the organizer portal and the medics' phones, with the band, the wearer's name and the zone.

#### The medic and your medical card

When you sign up by tapping your band, you can add two PDFs: your medical history and your health insurance card. Claude reads both into one medical card, and code keeps only the items that Claude can point to on a page of the PDF. The card holds your blood type, allergies, conditions, medications, emergency contact and insurer. You check the card once, and a medic later sees the card, never the PDFs.

A medic takes the alert on the portal and walks to the blue circle. A tap on the person's band with the medic's phone shows their name, the open fall or SOS and their medical card. If the person cannot speak, the card still tells the medic about allergies, medicines and who to call. Only medics can open a card, and BandIt records each opening with the medic, the person and the time. After treatment, the medic writes down the care and its cost, then closes the incident with one tap. Closing it turns off the band's SOS and opens the insurance claim while the facts are fresh.

#### The security camera

A camera in the security room watches the floor for one signal: a light ring that flashes red four times a second. Exit signs and other red lights never match that rhythm, so they never raise an alarm. The band's radio message says which band calls for help, and the camera says exactly where that band is. An alarm sounds, and a red marker shows the person on the live video, the floor plan and a 3D view of the hall. The camera never looks at faces. It finds light, and the band says who wears it.

The camera also judges each incident in its area. It records whether the frames confirm the incident, how sure it is, and the time and fingerprint of each frame, with a paragraph ready for an insurance claim. When it sees damage, such as a fallen speaker, it opens an incident for the equipment on its own. The laptop keeps the marked view and the last three seconds of video for each call, and the alarm works without internet.

### Insurance

The accident record that keeps people safe is also the evidence an insurer needs. BandIt uses it to settle claims while the facts are fresh.

#### A claim nobody has to file

When a guest gets hurt, BandIt opens the insurance claim for them, so nobody fills in a form. The claim opens when the medic closes the incident with a note. The venue's medical-payments cover, the part of its policy for hurt guests, pays for first aid and clinic care without anyone proving fault. It pays up to $5,000 per claim and $25,000 for the whole event. The payment goes straight into the guest's BandIt wallet, and BandIt drafts a plain letter that states the covered cost, the payment and the reason.

#### Evidence from every source

Every claim rests on evidence from several sources. The band reports the fall, the bands around it form the light circle, the medic writes a note, and the security camera sends its verdict. For each claim, Claude also writes the clinic's medical report, a PDF with an itemized bill, so the checks have real cases to catch. Chance decides whether its date, time, story and injury match the incident. The Decision Engine reads that report like any upload, and its checks catch the reports that do not fit.

#### The Evidence Engine and the Decision Engine

Two engines turn that evidence into a decision. The Evidence Engine runs on Elastic and gets a copy of each claim with no names. It ranks the closest past claims by meaning, with a score each, and each paid claim joins them a day later. The Decision Engine pairs Claude with Rust code. Claude reads the report, reviews the whole claim and drafts the letters. Code caps each bill line at the fee schedule, a price limit per treatment, so the policy pays, for example, $895.00 on a $1,308.00 urgent-care bill.

#### When a person decides

Claude's review can hold a claim for a person, but only code turns facts into dollars. A claim waits for the organizer when a check fails, when Claude has a doubt, or when no standing rule covers it yet. When three or more people get hurt in one zone within five minutes, the organizer decides each of those claims. An approval can teach BandIt a rule, so the next clean claim of the same kind, up to that amount, settles on its own. An approval from an old screen fails, so nobody pays out on numbers that moved.

#### What the insurer gets

For the insurer, BandIt drafts the first notice of loss, the report that opens an insurance claim, in the ACORD 3 section order. It lists every numbered fact behind the claim, the evidence pack, with a fingerprint that changes if any fact changes. When the insurer pays, the organizer records it, and the venue's books close the claim even if the amount differs.

#### Damage to the venue

The same policy covers the venue's own equipment, and the security camera reports damage such as a fallen speaker. After staff log the $2,400 repair cost and the claim settles, BandIt books $1,900 as the insurer's debt and $500 as the venue's share. If another company handled the equipment, Claude drafts a recovery letter that asks what they saw, and code rejects any draft that assigns blame.

### Social

You met someone great at a concert and forgot to get their Instagram. BandIt is built for that moment.

#### Signing up

To sign up, you tap the band with your phone, sign in with your email and press the band's button. The band blinks white for 8 seconds, and only a press on the band itself makes it yours. Then you type your name and add your Instagram, Facebook or Threads handles. BandIt never looks up a social account, so every handle comes from you.

#### Meeting people

From then on, the bands do the remembering. Each band listens for the bands around it, and two people who spend three minutes close together count as having met. Nobody swaps numbers or scans a code. After the event, your page lists the people you met, with their names and the handles they shared, each one a link to their profile. The person you spent twenty minutes with at a booth, and forgot to follow, is one tap away.

#### Your recap

When the host ends the event, the page on your band's tag turns into your recap, a summary of your night. It shows where you were and when, as one bar for each place you stayed on a timeline of the night. A dot on the timeline marks each person you met. Below it come the people you spent time with and the booths in the places you visited. The link on your band stays your way back, and it opens your recap on any phone once you sign in. Anyone else who taps your band learns only that it belongs to someone else.

#### Photos

Photographers upload their pictures during the event and pick the area where they took each one. BandIt finds the bands in that area when the picture arrives and adds the photo to up to eight of their recaps. It matches a photo to people only by time and place, against where the bands were, and nothing in BandIt looks at faces. Under each photo, you see the people in it whom you met, and a count of the others. A Share button opens your phone's share menu with the photo and a caption that holds the Instagram handles of the people you met.

#### Who can find you

One switch at sign-up decides whether people can find you, and it starts on. Two people meet only when both have it on. With it on, the people you met see your name and socials, and photos and the event graph can include you. With it off, you appear in no one's list, no one's photos and no graph. People in your photos whom you did not meet never see your name. The event graph on the organizer's screen draws people as unnamed dots, so it shows how the crowd connects without naming anyone.

### Shopping

Event merch usually means a long line and a bag to carry all night. BandIt sells nothing while the event runs, so your hands stay free for the people around you.

#### Merch made from your night

Once the host closes the event, one more tap of your band opens your recap, and the shop sits at the bottom of that page. You choose what you want after the night is over, when you know which moments mattered. The shop starts from your own night: which booths you visited, how long you stayed, and the photos you are in. From these facts it picks three products for you, each with one of your photos already in place. Products tied to the booths where you spent the most time come first, with a photo from that booth when one exists.

The products are shirts, mugs and posters. The event has six designs: a plain shirt, mug and poster, and three that name sponsors. The booth crawl poster names all six sponsors, so time at any of their booths counts toward it. Your friends are on the shirt or mug whenever they are in that photo with you. The shop stays empty until a photographer takes a photo of you.

#### Your wallet

Paying takes one tap from your BandIt wallet. You connect it at the end of band setup, and it starts with $200. The wallet is an account on Nessie, Capital One's practice bank for developers. A shirt costs $25, a mug $18 and a poster $15. The price leaves your balance the moment you tap Buy, and your order list shows the bank receipt once the purchase goes through. If the bank fails three times in a row, the order shows as failed, the money comes back, and you can buy again.

#### Getting paid

The same wallet also receives money. If you get hurt at the event and the venue's insurance pays your claim, the payout lands in this wallet as a deposit. Your wallet activity lists it with the claim number, next to your opening $200 and each purchase. If you skipped the wallet at setup, BandIt opens one for you, without the $200, when the payout arrives. Your balance is BandIt's own sum of these entries, so it changes the moment money moves.
