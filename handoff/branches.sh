#!/bin/sh
# Prints a Markdown table of the branches on origin whose commits are not in vik-e2e yet,
# for the "Unfinished branches" table in HANDOFF.md. Run it from the repo: handoff/branches.sh
set -e
git fetch -q origin '+refs/heads/*:refs/remotes/origin/*'
echo "| Branch | Commits not in vik-e2e | Last commit | Author | Subject |"
echo "| --- | --- | --- | --- | --- |"
git branch -r --no-merged origin/vik-e2e --format='%(refname:short)' | grep -v '^origin/HEAD$' | while read -r b; do
  # Skip branches whose changes reached vik-e2e through other commits.
  left="$(git cherry origin/vik-e2e "$b" | grep -c '^+' || true)"
  [ "$left" -gt 0 ] || continue
  git log -1 --format="| \`${b#origin/}\` | $left | %cd | %an | %s |" --date=format:'%m-%d %H:%M' "$b"
done
