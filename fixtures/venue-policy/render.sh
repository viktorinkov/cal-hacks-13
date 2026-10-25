#!/bin/sh
# Render the venue's insurance policy template to PDF with headless Chrome.
#
#   render.sh [out.pdf]
#
# The output defaults to rendered/venue-policy.pdf next to this script. The
# organizer uploads that PDF on the Venue setup tab of the organizer portal.
#
# Optional environment variables:
#   CHROME  path to the Chrome binary
set -eu

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

die() {
  echo "render.sh: $*" >&2
  exit 1
}

[ $# -le 1 ] || { echo "usage: $0 [out.pdf]" >&2; exit 2; }

script_dir=$(cd "$(dirname "$0")" && pwd)
template=$script_dir/templates/venue-policy.html
out=${1:-$script_dir/rendered/venue-policy.pdf}
case $out in
  /*) ;;
  *) out=$(pwd)/$out ;;
esac
mkdir -p "$(dirname "$out")"

[ -x "$CHROME" ] || die "Chrome not found at $CHROME (set CHROME to override)"
work=$(mktemp -d "${TMPDIR:-/tmp}/policy.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
url=file://$(printf '%s' "$template" | sed -e 's/%/%25/g' -e 's/ /%20/g')
rm -f "$out"
# A throwaway profile keeps headless Chrome away from the user's running browser.
"$CHROME" --headless=new --no-pdf-header-footer --disable-gpu --no-first-run \
  --no-default-browser-check --user-data-dir="$work/profile" \
  --print-to-pdf="$out" "$url" > "$work/chrome.log" 2>&1 \
  || { cat "$work/chrome.log" >&2; die "Chrome failed"; }

[ -s "$out" ] && [ "$(head -c 5 "$out")" = "%PDF-" ] || { cat "$work/chrome.log" >&2; die "Chrome did not write a PDF to $out"; }
echo "$out"
