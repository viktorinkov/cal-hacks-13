# Agent rules

## User-facing UI

- User-facing UI never names the underlying tech (Elastic, SpacetimeDB, Claude, Kibana, Bright Data) unless the user needs it to act.

## Research

- Agents that research something (Slack, sponsor pages, email, websites) use computer use or Claude in Chrome when a page needs a browser or a sign-in, instead of giving up on it.
- Agents do sign-ins themselves through computer use or Claude in Chrome. Never ask Viktor to sign in.

## Parallel work

- Parallelize by default: split independent work across parallel agents and threads, without overdoing it.
- Each new feature gets its own branch and thread, unless it closely matches work already in progress.

## Randomness

- Random outcomes, for example whether a claim matches the insurance, come from a seeded RNG in code, never from Claude or another model.

## Permissions

- This project's auto mode rules live in `scripts/agent-permissions`. For a new kind of block, add the entry there and give Viktor one command: `python3 ~/Development/CalHacks\ 13.0/scripts/agent-permissions`. It backs up his settings first and is safe to rerun.
- Agents may edit the project's `.claude/settings.json` and `.claude/hooks/` to add project-scoped allow rules, for example for the repo's scripts, `spacetime`, the VM and `/mnt/project-files`.
- Never add broad rules: no `Bash(*)`, bare interpreters, `rm` or `curl`.

## Git

- The SessionStart hook `.claude/hooks/git-identity` sets Viktor's identity when it is unset or `noreply@anthropic.com`.
- In any clone or worktree the hook does not cover, set `user.name` to `Viktor Minchev` and `user.email` to `vikitominchev@gmail.com` before the first commit. Never commit as Claude.
- Commit and merge messages never point at Claude: no `claude/` branch names, claude.ai links, `Claude-Session` or `Co-Authored-By` lines. Merge with `git merge -m "merge <what it brings>" <branch>`, never with the default message. `.githooks/commit-msg` rejects these, and the SessionStart hook `.claude/hooks/git-hooks` turns it on.

## Deleting files

- Use `rm -rf` only with literal absolute paths, never with shell variables. The built-in safety check refuses variable paths.
