# Changelog

## 2.2.0 — Multiplayer, security and voting update

- Backend now issues browser guest Player IDs and validates Discord OAuth access tokens before trusting Discord user IDs; client-provided IDs are ignored.
- Secret word, explanation and image metadata are delivered only to the GM. Secret data is not included in public room state or the final result API.
- Self-voting is rejected by the backend and disabled in the voting UI.
- Tied top vote results start a 60-second runoff restricted to tied candidates. Repeated ties start another runoff, and each round is retained separately in the result.
- Player lists show `YOU`; the active turn is marked `YOUR TURN`.
- Results are presented as a modal-style overlay with per-round vote details.
- Per-room used-word history is stored in SQLite and survives a server process restart for a reused room code.
- Added a word database validator and unit tests for duplicate names, secret isolation, persistent word selection and runoff behavior.

## Known incomplete requirements

- The word pool has been expanded to 452 curated entries across 38 categories, below the requested 1,000–2,000 target. The new entries have original editorial descriptions; legacy entries still require source review.
- Image URLs are not embedded for all entries. The GM UI can look up Wikimedia Commons images at view time; results are not guaranteed and their license/suitability should be checked before production use.
- Active rooms and player sessions remain in memory. Server restart ends active games, and reconnect/session recovery is not implemented.
- A real Discord Activity launch and production OAuth configuration require credentials and Discord Developer Portal settings that are not included in this source package.

- Expanded `words.json` from 55 to 452 unique entries, with 158 Easy, 150 Medium and 144 Hard entries across 38 categories.

- Results are presented in an accessible modal overlay over the game screen.
