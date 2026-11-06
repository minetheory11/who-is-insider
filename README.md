# The Manipulator

Discord Activity / browser party game built with FastAPI, WebSocket, HTML, CSS and JavaScript.

## Run locally

```bash
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://127.0.0.1:8000/`. Copy `.env.example` to `.env` only if you want the optional Discord DM assistant, then set `DISCORD_BOT_TOKEN`. Never distribute `.env`.

## Game flow and roles

- Home collects only the display name. The room code is entered in the Lobby join panel.
- Lobby supports 3–12 players. Duplicate names receive numbered suffixes; Player IDs are independent of display names.
- Discord Embedded App access tokens are validated by the backend against Discord `/users/@me`. Browser guests receive server-generated IDs; client-supplied IDs are not trusted.
- GM, Manipulator and regular player roles are assigned server-side. Only the GM receives the secret word, explanation, category, difficulty and image attribution. Manipulator and regular players do not receive secret data.
- Players and Manipulator take 30-second turns. GM answers with Yes / No / Maybe. Public question history is shared.
- A correct guess starts a 60-second vote. GM cannot vote, and both UI and backend reject self-votes. A tie starts a 60-second runoff restricted to tied candidates; further ties start another runoff.
- Results show each voting round separately, the identified Manipulator, the outcome and the secret word after the game has ended.
- Host can return the room to Lobby and start a new round. Roles and words are reselected; public question history is cleared.
- How to Play is available as a reusable popup in Lobby and Game.

## Word database and history

`backend/game/database/words.json` contains the curated starter set (452 entries) with word, GM explanation, category, difficulty, image URL, source URL, creator credit and license fields. Missing image URLs can be resolved by the GM browser via Wikimedia Commons; attribution metadata is shown where available.

Used-word history is stored in `backend/game/database/room_word_history.sqlite3` so a room does not repeat a word until its available pool is exhausted. Difficulty balancing is applied across rounds in a live room. The SQLite file is created automatically and should be kept with persistent application data in deployment.

The current curated set contains 452 unique entries across 38 categories, with Easy/Medium/Hard represented (158/150/144). This is a substantial expansion, but it does not yet reach the requested 1,000–2,000 target. Newly added explanations are original project editorial text. The existing 55 entries retain their legacy provenance status and still need per-entry source review. Image URLs are not prefilled: the GM UI may search Wikimedia Commons at view time, and each result must be checked for suitability and license before production use. The schema supports adding reviewed entries without changing the randomizer.

## Runtime limitations / deployment notes

- Room/player state and active matches remain in memory; an application restart ends active rooms. SQLite preserves word-use history for a room code, but active-room recovery is not implemented.
- Browser guest identities are server-issued per connection and are not durable across refreshes. Discord users are authenticated using their OAuth access token.
- Configure Discord Activity OAuth scopes, allowed URL/domain and the embedded-app network allowlist in the Discord Developer Portal.
- Wikimedia Commons access requires the relevant domain to be allowed in the Activity configuration.
- Optional bot DM requires a valid `DISCORD_BOT_TOKEN` and enabled user DMs.

## Applying this update to an existing Git checkout

1. Commit or stash your current work first, and keep a separate backup of `.env` and any deployment secrets.
2. Do not copy `.git/`, `node_modules/`, `.env`, or the generated SQLite file from an update archive. Keep your existing Git remote, branches, history, Discord application settings, and deployment configuration.
3. Replace only the project source files included in this update (or apply the supplied patch if it matches your current base revision). Review `git diff` before committing.
4. Install dependencies from the lockfile (`npm ci` when using npm; Python dependencies with `python -m pip install -r requirements.txt`).
5. Preserve your existing `.env`; compare it with `.env.example` and add only missing variables. Never commit `.env`.
6. Back up and persist `backend/game/database/room_word_history.sqlite3` in production. It is runtime data and is intentionally not shipped in the source archive.
7. Run `python scripts/validate_words.py`, `python -m unittest discover -s tests -v`, `python -m py_compile backend/main.py backend/game/session.py`, and `node --check frontend/js/app.js` before deployment.

If your Git working tree has unrelated edits, do not overwrite it wholesale. Apply the changed files selectively and inspect the diff. A patch generated from this source checkout applies cleanly only when the target checkout has the same base revision.
