# Synthetic medical records (demo fixtures)

Fictional US clinical paperwork for the BandIt insurance demo. When an attendee is hurt at the event, the venue's medical-payments coverage pays treatment costs. Claude reads each PDF into a structured record (`expected/<name>.json`), and code then checks the record and computes the covered amount.

Every patient, clinician, clinic, home address, phone number and ID in these files is invented. Every page has the footer `SYNTHETIC RECORD - DEMO DATA - NOT A REAL PATIENT`.

The event, venue and zone names come from placeholders. The claims agent compares each record with the real incident, so these names must match the event. The defaults are `Cal Hacks 13.0`, `Cal Hacks 13.0 venue` and `Main stage`. The urgent care clinic (Wrenfield Urgent Care) is fictional.

## Records

| Template | Pages | Patient | Invoice (default) | Billed | Role in the demo |
|---|---|---|---|---|---|
| `first-aid-wrist` | 1 | Maya Chen | `FA-1024-0007` | $180.00 | Small claim that settles automatically. The event's own medical station treats a right wrist sprain on the incident night: she slipped on a spilled drink near `{{ZONE_NAME}}` at `{{EVENT_NAME}}`. |
| `urgent-care-wrist` | 2 | Jordan Alvarez | `UC-2025-1188` | $1,308.00 | Larger claim that goes to the risk manager. Urgent care visit the day after the event. The patient has a left wrist sprain: he fell at `{{EVENT_NAME}}` when the crowd surged near `{{ZONE_NAME}}`. Covered amount is $895.00 after the fee schedule: six lines are cut to the schedule cap and the unrelated Tdap shot (90715) is excluded and flagged for a person. |
| `urgent-care-ankle-home` | 2 | Sam Patel | `UC-2025-1201` | $565.00 | The claims agent finds that the injury happened at home. The codes and charges look routine, but the history says that he twisted the ankle playing basketball at home the evening before. He then attended `{{EVENT_NAME}}`, where it got worse. (The place-of-occurrence code Y92.009, private residence, is also in the assessment.) |

On the 2-page records, page 1 is the clinical note and page 2 is the itemized bill.

## Layout

```
templates/<name>.html   HTML templates (inline CSS, letter size, no external assets)
expected/<name>.json    the record Claude should extract, for incident date 2026-10-24 and the default invoice suffix
rendered/<name>.pdf     the templates rendered for incident date 2026-10-24
render.sh               fills the placeholders and prints to PDF with headless Chrome
```

## Rendering

The demo runs on judging day, so the dates are filled in when you render. Give the date of the event night as the incident date:

```sh
./render.sh <template-name> <incident-date YYYY-MM-DD> <out.pdf> [invoice-suffix]

./render.sh first-aid-wrist 2026-10-24 rendered/first-aid-wrist.pdf
./render.sh urgent-care-wrist 2026-10-24 /tmp/uc.pdf 2025-1300
EVENT_NAME="Cal Hacks 13.0" VENUE_NAME="Cal Hacks 13.0 venue" ZONE_NAME="Main stage" \
  ./render.sh first-aid-wrist 2026-10-24 /tmp/fa.pdf

for t in first-aid-wrist urgent-care-wrist urgent-care-ankle-home; do
  ./render.sh "$t" 2026-10-24 "rendered/$t.pdf"
done
```

The script runs on macOS: it uses BSD `date` and Google Chrome in headless mode, with a temporary profile. To use a different Chrome binary, set `CHROME=/path/to/chrome`. To set the event, venue and zone names, set the environment variables `EVENT_NAME`, `VENUE_NAME` and `ZONE_NAME`. If a variable is empty or not set, the script uses the default. The script HTML-escapes these values. It stops with an error if a value has a line break, `{` or `}`. If you do not give an invoice suffix, the script uses the template's `<meta name="default-invoice-suffix">` value. The script stops with an error if the date is not a real calendar date, if the suffix has characters other than letters, digits and `-`, or if a placeholder is left unfilled.

`expected/*.json` matches the default names. If you render with a different incident date or different names, the expected values change too. For the first-aid record, the service date is the incident date. For the urgent care records, it is the next day. The `history` text contains the long-form dates and `EVENT_NAME` (records 1 and 2 also contain `ZONE_NAME`). In record 1, `provider.name` is `Event Medical Station - <EVENT_NAME>` and `provider.address` is `<VENUE_NAME>`, because the station has no street address.

Check the page count with `pdfinfo rendered/<name>.pdf`, or with `grep -a -o '/Type */Page\b' rendered/<name>.pdf | wc -l`. The count must equal the highest `page` value in the expected JSON (1, 2, 2). `mdls` returns `(null)` for files that Spotlight has not indexed, such as files under `/tmp`.

## Placeholders

| Placeholder | Example (incident date 2026-10-24) |
|---|---|
| `{{INCIDENT_DATE}}` | `2026-10-24` (the event night) |
| `{{INCIDENT_DATE_LONG}}` | `Saturday, October 24, 2026` |
| `{{NEXT_DATE}}` | `2026-10-25` |
| `{{NEXT_DATE_LONG}}` | `Sunday, October 25, 2026` |
| `{{BEFORE_DATE}}` | `2026-10-23` |
| `{{BEFORE_DATE_LONG}}` | `Friday, October 23, 2026` |
| `{{INVOICE_SUFFIX}}` | `1024-0007`, `2025-1188` or `2025-1201` (template default) |
| `{{EVENT_NAME}}` | `Cal Hacks 13.0` (env `EVENT_NAME`) |
| `{{VENUE_NAME}}` | `Cal Hacks 13.0 venue` (env `VENUE_NAME`) |
| `{{ZONE_NAME}}` | `Main stage` (env `ZONE_NAME`) |

## Fictional identifiers

- NPI-style numbers have 10 digits, but they fail the NPI check-digit test, so they cannot be real NPIs.
- Phone numbers use the reserved fictional range `555-01xx`.
- The Tax ID starts with `00`, a prefix that is not issued.
- Wrenfield Urgent Care, the patients' home addresses in "Port Alder, CA 949xx", and the clinicians are invented.
