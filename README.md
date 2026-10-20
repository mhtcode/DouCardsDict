# DouCardsDict

DouCardsDict is a private-first English listening and vocabulary studio for a DuoCards collection. It combines dictation practice, semantic relationship clouds, Persian meaning reveal, FSRS scheduling, and optional local AI enrichment in a responsive React interface.

The application runs locally on Windows or as a Docker service behind HTTPS. Personal cards, Persian translations, review history, sessions, exports, and SQLite databases are deliberately excluded from this public repository.

## Highlights

- Six non-blocking practice modes: transcription, learner-controlled dictation, contextual cloze, sentence reconstruction, sound discrimination, and letter building
- Automatic grading based on correctness, edit distance, response time, replay count, and hints, with optional rating overrides
- FSRS scheduling, permanent Skip and Next controls, progressive hints, and configurable correct/incorrect auto-advance
- Interactive relationship cloud with semantic, context, pronunciation, spelling, morphology, and hybrid similarity; click to inspect, double-click to recenter, or export as PNG/SVG
- Persian meaning and English definition reveal from selected or clicked English text
- Daily progress charts for practiced words, checked answers, and success rate
- Owner settings for name, email, browser voice, accent, speed, pitch, playback, and timers
- Secure single-owner sessions with scrypt password hashing, HttpOnly cookies, CSRF protection, and login throttling
- DuoCards startup/manual sync plus a four-hour schedule, retry backoff, idempotent imports, and SQLite backups
- Optional Ollama enrichment with `embeddinggemma` and `qwen3:4b`; cached results keep the deployed app independent of the larger model

## Requirements

- Node.js 24 or newer
- npm
- Optional: Ollama for embeddings and richer definition/contrast enrichment
- Optional: Docker Engine and Docker Compose for server deployment

## Local setup

```powershell
Copy-Item .env.example .env
npm ci
npm run build
npm start
```

Open <http://localhost:8765>. On the first local visit, create the owner password. For safety, initial owner setup is unavailable to remote clients.

Set `DUOCARDS_DECK_ID` in `.env` to the deck identifier used by the DuoCards CSV download. The initial sync populates a new database. If DuoCards changes its export endpoint, use the Sync page to import a downloaded CSV instead.

On Windows, `Start-English-Studio.ps1` installs dependencies when needed, builds the interface, starts the server, and opens it in the browser:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-English-Studio.ps1
```

To install Ollama and pull the recommended models:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-Ollama.ps1
npm run enrich
npm run verify:data
```

Enrichment is resumable. Only new or content-changed entries need new definitions, vectors, and neighbor caches. A queued definition job does not necessarily mean an embedding is missing; the Sync page reports definition, vector, and cache coverage separately.

## Useful commands

```powershell
npm run dev           # API and Vite development servers
npm run check         # typecheck, unit tests, and production build
npm run enrich        # resume definitions, embeddings, and neighbor caches
npm run verify:data   # vector, cache, FSRS, and duplicate-sync checks
npm run backup        # verified SQLite backup; retain the newest 14
```

Runtime data is stored in `data/word-studio.db`, with backups in `data/backups/`. These paths and `vocabulary.json` are ignored by Git and Docker because they contain private learning data.

## Docker and Hetzner deployment

1. Point a domain's A/AAAA record at the server.
2. Clone this repository into a private directory on the server.
3. Copy `.env.example` to `.env` and set `DOMAIN`, `DUOCARDS_DECK_ID`, and a long unique `APP_PASSWORD`.
4. Start and verify the stack:

```bash
docker compose up -d --build
docker compose ps
curl -fsS https://your-domain.example/api/health
```

Caddy obtains and renews TLS automatically. The application runs as UID 10001, exposes its direct port only on server localhost, and stores SQLite in the persistent `studio-data` volume. A new volume starts with an empty schema and is populated through DuoCards sync or CSV import.

To enrich newly synchronized cards on the server, enable the optional Ollama profile:

```bash
docker compose --profile enrichment up -d ollama
docker compose --profile enrichment exec ollama ollama pull embeddinggemma
docker compose up -d word-studio
```

Install `qwen3:4b` in the sidecar only when server-side definition generation is also wanted. Context, spelling, pronunciation, and morphology similarity remain available if Ollama is offline.

## Security

- Use the Caddy HTTPS endpoint over the internet; do not expose port 8765 publicly.
- State-changing APIs require a valid session and CSRF token.
- Login failures are throttled and expired sessions are removed automatically.
- Keep `.env`, SQLite files, exports, logs, and backups private.
- Back up the Docker volume or use the in-app backup action before maintenance.

## Verification

Run `npm run check` before committing. CI runs the same typecheck, unit tests, and production build for pushes and pull requests.
