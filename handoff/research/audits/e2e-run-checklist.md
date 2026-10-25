# End-to-end run on Maincloud (vik-e2e 8b79e24)

Run in Viktor's Chrome on http://localhost:8097 against bandit-calhacks13-sp82j, with test bands 97, 98 and 99 and the story attendees 90-93.

## Pass

| Step | Result |
|---|---|
| Band setup: tap link, press, name, socials | Pass on bands 97, 98, 99 |
| Medical history and insurance PDFs, real upload and test record | Pass after fixes (file kept across refreshes, each step has its own input) |
| Claude's medical card, "Looks right" | Pass |
| "Is this you?" profile claim | Pass (Sergey Levine claimed; row text fixed) |
| Capital One wallet connect, $200 on Nessie | Pass |
| Reload in the middle of setup | Pass after fix (resumes at the first unfinished step) |
| Checkboxes (findable, learn a rule) | Pass after fix |
| Bands tab: walk bands between zones, Live counts | Pass |
| Photographer adds a photo, people in that zone tagged | Pass after fix (real attendees ahead of the crowd) |
| Fall, medic takes it, taps the band for the medical card | Pass (band 98 shows Sergey's card; story attendees now have cards) |
| Claim: Claude reads the record, Elastic validates and finds precedents, Claude reviews, code routes | Pass (claim 1, Maya Chen, $180) |
| Approval with "learn", rule v1, Nessie payout to the wallet | Pass |
| Insurance story: learned rule v2 ($895 after fee-schedule cuts), home ankle injury routed as inconsistent, Lee's fake refused by witness_zone, speaker property claim settled | Pass (story step 2 hit record_duplicate because of the earlier hand-run claim; fixed in cccde49, not rerun) |
| New host portal: role-based tabs, Attendees with band status, bands 90-99 | Pass |
| Kibana: import run, sponsors and prizes, claims evidence | Pass |
| "Event ended": every open tap link turns into the recap live | Pass |
| Recap: timeline, people and booths ranked by Elastic, photo with "That's me" | Pass, with the two failures below |
| Merch: mockups with the photo, Buy Elastic mug $18 from the wallet | Pass (order paid, Nessie purchase recorded, wallet $182) |

## Fail (sent to the builder)

1. Minutes together are 6x too high for tester bands. The scripted crowd adds 30 s of "together" every 5 s and pairs testers with it, so Sergey's 13-minute night shows "Robin Tester · 50 min together".
2. The recap timeline splits one Sponsor row visit into four back-to-back stays and lists all 51 booths under each one.

## Minor

- The Kibana link "Event story" opens the dashboard titled "sponsors and prizes".
- Three zones have no exit colour ("none") in the imported event data.

## Not run

- Low visibility: it broadcasts to the real bands.
- Email sign-in and the owner's grant-role sign-in: they need Viktor's email.
- Share on a photo: it downloads a file.
- "Take the band back" button: the reducer was checked from the command line instead.

The event is left ended so the recaps stay visible; "Reopen the event" in the host portal undoes it.
