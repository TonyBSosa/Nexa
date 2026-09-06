# NEXA

NEXA is an organizational knowledge intelligence concept that turns questions and missing knowledge into human-approved, reusable documentation. See [the project brief](docs/PROJECT_BRIEF.md) for product scope.

## Current Stage

Knowledge Recovery Loop: SQLite-backed gaps now progress through triage, simulated recovery, evidence collection, versioned drafting, human review, local publication, and explicit resolution. Published articles immediately answer matching chat questions through NEXA Approved Knowledge. FakeAgentProvider remains active; Botpress, real external actions, authentication, analytics dashboards, final UI, Tailwind/shadcn, and Docker remain pending.

## Prerequisites

- Node.js 24.14 or newer within major 24; npm 11.
- Git and two development terminals. No database or Docker is required.

TypeScript 6 is used because it is compatible with the configured TypeScript ESLint tooling. The root lockfile records resolved dependencies for all workspaces.

## Structure

```text
apps/web/                 React + Vite bootstrap
apps/api/                 Express API
packages/shared/         Provider-neutral shared TypeScript contracts
knowledge/documents/     Future synthetic documents
knowledge/test-questions/ Future questions, aliases, expected outcomes
docs/                    Product and architecture foundation
```

Read AGENTS.md before contributing. Imports of shared contracts use `@nexa/shared`; root commands build its declarations before consumers. After editing shared types during development, run `npm run build -w @nexa/shared` or restart the root development commands.

## Install

From the repository root after cloning:

```sh
npm ci
```

When intentionally adding dependencies, use npm install and include the updated package-lock.json in the reviewed change. Do not commit automatically.

## Run Locally

Terminal one, from the root:

```sh
npm run dev:api
```

Terminal two:

```sh
npm run dev:web
```

- Web: http://127.0.0.1:5173
- API health: http://127.0.0.1:3000/api/health

Click **Check API health** in the development page. Expected result: `nexa-api: ok`. The browser calls `/api/health` on Vite, which proxies to the configured backend URL. No direct Botpress calls or CORS package are needed. The health button is omitted from production builds.

Defaults work without environment files. `.env.example` lists optional **shell** variables; no populated .env file is supplied or required, and these scripts do not load one. For a different API port in PowerShell, set `$env:PORT = '3001'` in the API terminal and `$env:API_URL = 'http://127.0.0.1:3001'` in the web terminal before starting. Restart after changing configuration. Never put secrets in browser-exposed configuration or Git.

## Deterministic Chat Development

`POST /api/chat` accepts `{"message":"...","clientSessionId":"optional-uuid"}`. Use the question form and Send button at the local web URL. Each valid submission receives a persisted Query UUID, including non-organizational questions and controlled provider failures. Only relevant INSUFFICIENT assessments with completed retrieval create/reuse a gap and return `knowledgeGapId`. Canonical approved knowledge is supplied to the provider as neutral context and rechecked inside the final query-write transaction. It returns grounded `nexa-approved` evidence even when a delayed provider assessment says INSUFFICIENT.

| Example | Result |
| --- | --- |
| ¿Qué tóner utiliza la impresora MX550? | 200 SUFFICIENT with explicitly fictional NX-550 Black toner and synthetic evidence. |
| ¿Cuál es el procedimiento de la empresa para dar de baja una impresora? | 200 INSUFFICIENT with TI / Equipos category, Soporte de TI roles, and three recovery proposals. |
| ¿Cuál es la capital de Francia? | 200 with organizationallyRelevant false; successful domain assessment, not a gap candidate. |
| simular fallo del agente | 503 FAILURE with a sanitized message; trigger enabled only outside NODE_ENV=production. |

Spanish is primary for visible examples, default questions, and demo response text. English aliases remain supported and tested: “What toner does the MX550 printer use?”, “What is the company procedure for retiring a printer?”, “What is the capital of France?”, and “simulate agent failure”. Status values, action types, HTTP behavior, and provider-neutral contracts are unchanged.

Only the small explicit English/Spanish fixture aliases are recognized. Other questions (including greetings and unsupported organizational questions) return the out-of-scope development response; this fake is not a general relevance classifier. It makes no external calls. No proposed action is executed.

**Task-specific contract differences:** this implementation keeps the agent-foundation request's `message` input and `evidence` output rather than the provisional `question`/`sources` fields. Successful assessments retain HTTP 200, including non-organizational questions. Their structured response keeps existing OUT_OF_SCOPE metadata. Provider failures remain 503 and are now logged with FAILURE status; invalid messages/malformed JSON return 400 and are not logged (oversized bodies: 413). This persistence task explicitly supersedes the earlier plan not to log unrelated/failed attempts. Future knowledge metrics must filter these records rather than count them as missing organizational knowledge. Database failures return a sanitized 500 PERSISTENCE_ERROR; no successful save or partial occurrence increment is claimed. `/api/health` is unchanged.

## SQLite and Read Endpoints

The API creates `data/nexa.db` under the repository root on startup using better-sqlite3, without an ORM. Set the shell variable `DATABASE_PATH` to override it; relative paths are always repository-root relative in development and compiled runs. `.env.example` documents the default without creating an environment file. Database files are ignored by Git.

Schema version 3 is initialized transactionally using SQLite `user_version`; earlier databases are migrated in place. SQLite stores queries, gaps, collected evidence, draft revisions, review decisions, and approved articles. A foreign key links queries to gaps, and a partial unique index allows only one non-RESOLVED gap per normalized key. Related workflow writes use synchronous transactions so failures do not leave partial state.

Matching lowercases, removes accents, normalizes punctuation (including Spanish punctuation) to spaces, trims, and collapses whitespace. Explicit Spanish/English toner and printer-retirement aliases share canonical keys. Titles preserve the first question independently of matching. New gaps are DETECTED/MEDIUM with occurrences 1. The development frontend stores an anonymous UUID in `localStorage` and sends it as the optional `clientSessionId`. For the same session and gap, eligible queries within five minutes of the last counted occurrence are all persisted but do not increase demand; another session or a later query increments it. Each Query records whether it counted toward the gap. When `clientSessionId` is absent, each eligible query increments as before, preserving compatibility for API clients. IP addresses are not collected or used. No semantic/vector matching is used.

- `GET /api/queries`: `{ "items": [...] }`, newest first; includes statuses, relevance, evidence, and nullable gap links.
- `GET /api/knowledge-gaps`: `{ "items": [...] }`, newest updated first; optional documented lifecycle `?status=DETECTED` filter.
- `GET /api/knowledge-gaps/:id`: a gap object, or 404 NOT_FOUND.
- `GET /api/knowledge`: locally published NEXA Approved Knowledge articles.

## Knowledge Operations Demo

The development page includes a plain Knowledge Operations harness. Ask “¿Cuál es el procedimiento de la empresa para dar de baja una impresora?”, copy its `knowledgeGapId` into the harness, and use the controls in order:

1. Save triage metadata (state stays DETECTED), then explicitly confirm review (`DETECTED → TRIAGED`).
2. Select a proposed action, then explicitly approve starting it (`ACTION_PROPOSED → IN_PROGRESS`). The action is simulated; no email, meeting, document request, or external task is executed.
3. Add the prefilled synthetic evidence (state stays IN_PROGRESS), explicitly confirm KNOWLEDGE_COLLECTED, and generate a versioned draft (state stays KNOWLEDGE_COLLECTED). Inspect it and explicitly submit AWAITING_APPROVAL. FakeAgentProvider builds the draft only from the supplied evidence.
4. Approve the current fresh revision. Approval, local article publication, and `PUBLISHED` commit atomically. Changes requested or rejection return the gap to `KNOWLEDGE_COLLECTED` and require a newer draft.
5. Ask the same question again to receive a `SUFFICIENT` response from NEXA Approved Knowledge, then explicitly close the gap (`PUBLISHED → RESOLVED`).

Mutation routes are `PATCH /api/knowledge-gaps/:id/triage` and `POST` to `/:id/transition`, `/:id/evidence`, `/:id/draft`, and `/:id/approval`. Evidence revisions make older drafts stale; only the latest draft using the current evidence revision can be submitted and approved. Successful APPROVED retries reuse the same publication, including after resolution; conflicting reviews return 409. Malformed provider responses return sanitized 502 INVALID_PROVIDER_RESPONSE. Recovery actions and human decisions are persisted locally. Botpress and real Microsoft 365 or document-system integrations are not active.

To reset local demo data, stop the API, remove only the configured SQLite database file and its matching `-journal`, `-wal`, and `-shm` sidecars if present, then restart. With defaults these are under the root `data/` directory. This deletes local demo queries/gaps; verify the configured path before deleting. Tests use in-memory or isolated temporary databases and never access the development database.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Lint covers all workspaces and root JavaScript configuration. Typecheck uses strict TypeScript. Build compiles shared contracts and API, then bundles the web app. Output is in each workspace's ignored `dist/` directory.

After building, run the compiled API with `npm run start -w @nexa/api`. Preview the frontend with `npm run preview -w @nexa/web`; the development proxy and health button are not part of production preview, so chat requires backend routing when deployed. Tests use Node's built-in runner with the existing tsx loader and cover the fake provider, service, and HTTP boundary. Tests bind an ephemeral local port and make no external requests.

If a port is occupied, stop the conflicting local server or configure a different API port. Vite fails on a busy 5173 rather than silently changing the documented URL. In PowerShell environments that block npm.ps1, use `npm.cmd` for the same commands. Stop development servers with Ctrl+C.
