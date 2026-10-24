#!/bin/sh
# Render a synthetic medical-record template to PDF with the dates filled in.
#
#   render.sh <template-name> <incident-date YYYY-MM-DD> <out.pdf> [invoice-suffix]
#
# <template-name> is a file name in templates/ without ".html" (for example
# first-aid-wrist), or a path to an .html template. The invoice suffix defaults
# to the template's <meta name="default-invoice-suffix"> value.
#
# Optional environment variables (empty or unset means the default):
#   EVENT_NAME  fills {{EVENT_NAME}}  (default: Cal Hacks 13.0)
#   VENUE_NAME  fills {{VENUE_NAME}}  (default: Cal Hacks 13.0 venue)
#   ZONE_NAME   fills {{ZONE_NAME}}   (default: Main stage)
#   CHROME      path to the Chrome binary
# Uses BSD date on macOS, GNU date on Linux, and Chrome in headless mode.
set -eu
export LC_ALL=C

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
EVENT_NAME=${EVENT_NAME:-"Cal Hacks 13.0"}
VENUE_NAME=${VENUE_NAME:-"Cal Hacks 13.0 venue"}
ZONE_NAME=${ZONE_NAME:-"Main stage"}

usage() {
  echo "usage: $0 <template-name> <incident-date YYYY-MM-DD> <out.pdf> [invoice-suffix]" >&2
  exit 2
}
die() {
  echo "render.sh: $*" >&2
  exit 1
}

[ $# -ge 3 ] && [ $# -le 4 ] || usage

script_dir=$(cd "$(dirname "$0")" && pwd)
name=$1
incident=$2
out=$3

case $name in
  */* | *.html) template=$name ;;
  *) template=$script_dir/templates/$name.html ;;
esac
[ -f "$template" ] || die "template not found: $template"

if [ $# -eq 4 ]; then
  suffix=$4
else
  suffix=$(sed -n 's/.*<meta name="default-invoice-suffix" content="\([^"]*\)".*/\1/p' "$template" | head -n 1)
  [ -n "$suffix" ] || die "no invoice suffix given and $template has no default-invoice-suffix meta tag"
fi
case $suffix in
  '' | *[!A-Za-z0-9-]*) die "invoice suffix may contain only letters, digits and '-': $suffix" ;;
esac

# Event names are free text: reject line breaks and braces, then HTML-escape
# them and escape them for use in a sed replacement with '|' as the delimiter.
nl=$(printf '\nx')
nl=${nl%x}
cr=$(printf '\r')
text_value() { # text_value <VAR_NAME> <value>
  case $2 in
    *"$nl"* | *"$cr"* | *'{'* | *'}'*) die "$1 must be one line without '{' or '}': $2" ;;
  esac
  printf '%s' "$2" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' -e 's/[\\|&]/\\&/g'
}
EVENT_NAME_SED=$(text_value EVENT_NAME "$EVENT_NAME")
VENUE_NAME_SED=$(text_value VENUE_NAME "$VENUE_NAME")
ZONE_NAME_SED=$(text_value ZONE_NAME "$ZONE_NAME")

# Validate the incident date. BSD date normalizes impossible dates (2026-02-30
# becomes 2026-03-02), so require an exact round trip. Noon avoids DST edges.
case $incident in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *) die "incident date must be YYYY-MM-DD: $incident" ;;
esac
day() { # day <YYYY-MM-DD> <offset like +1d> <format>
  if date -j > /dev/null 2>&1; then
    date -j -v"$2" -f "%Y-%m-%d %H:%M:%S" "$1 12:00:00" "$3"
  else
    date -u -d "$1 ${2%d} day" "$3"
  fi
}
[ "$(day "$incident" +0d +%Y-%m-%d 2>/dev/null)" = "$incident" ] || die "not a valid calendar date: $incident"

long='+%A, %B %-d, %Y'
INCIDENT_DATE=$incident
INCIDENT_DATE_LONG=$(day "$incident" +0d "$long")
NEXT_DATE=$(day "$incident" +1d +%Y-%m-%d)
NEXT_DATE_LONG=$(day "$incident" +1d "$long")
BEFORE_DATE=$(day "$incident" -1d +%Y-%m-%d)
BEFORE_DATE_LONG=$(day "$incident" -1d "$long")

case $out in
  /*) ;;
  *) out=$(pwd)/$out ;;
esac
mkdir -p "$(dirname "$out")"

work=$(mktemp -d "${TMPDIR:-/tmp}/medrec.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
html=$work/$(basename "$template" .html).html

sed -e "s|{{INCIDENT_DATE}}|$INCIDENT_DATE|g" \
    -e "s|{{INCIDENT_DATE_LONG}}|$INCIDENT_DATE_LONG|g" \
    -e "s|{{NEXT_DATE}}|$NEXT_DATE|g" \
    -e "s|{{NEXT_DATE_LONG}}|$NEXT_DATE_LONG|g" \
    -e "s|{{BEFORE_DATE}}|$BEFORE_DATE|g" \
    -e "s|{{BEFORE_DATE_LONG}}|$BEFORE_DATE_LONG|g" \
    -e "s|{{INVOICE_SUFFIX}}|$suffix|g" \
    -e "s|{{EVENT_NAME}}|$EVENT_NAME_SED|g" \
    -e "s|{{VENUE_NAME}}|$VENUE_NAME_SED|g" \
    -e "s|{{ZONE_NAME}}|$ZONE_NAME_SED|g" \
    "$template" > "$html"

if grep -q '{{[A-Z_]*}}' "$html"; then
  die "unknown placeholder left in $template: $(grep -o '{{[A-Z_]*}}' "$html" | sort -u | tr '\n' ' ')"
fi

[ -x "$CHROME" ] || die "Chrome not found at $CHROME (set CHROME to override)"
url=file://$(printf '%s' "$html" | sed -e 's/%/%25/g' -e 's/ /%20/g')
rm -f "$out"
# A throwaway profile keeps headless Chrome away from the user's running browser.
"$CHROME" --headless=new --no-pdf-header-footer --disable-gpu --no-first-run \
  --no-default-browser-check --user-data-dir="$work/profile" \
  --print-to-pdf="$out" "$url" > "$work/chrome.log" 2>&1 \
  || { cat "$work/chrome.log" >&2; die "Chrome failed"; }

[ -s "$out" ] && [ "$(head -c 5 "$out")" = "%PDF-" ] || { cat "$work/chrome.log" >&2; die "Chrome did not write a PDF to $out"; }
echo "$out"
