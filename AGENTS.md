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

## Git

- Set `user.name` to `Viktor Minchev` and `user.email` to `vikitominchev@gmail.com` in every clone and worktree before the first commit. Never commit as Claude.
