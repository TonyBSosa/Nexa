# NEXA

NEXA is an organizational knowledge intelligence concept that turns questions and missing knowledge into human-approved, reusable documentation. See [the project brief](docs/PROJECT_BRIEF.md) for product scope.

## Current Stage

Agent foundation: minimal React question form, Express health/chat endpoints, shared contracts, and a deterministic FakeAgentProvider. Botpress integration, SQLite persistence, Knowledge Gaps, product workflows, authentication, final UI, Tailwind/shadcn, and Docker are not implemented. Fake responses demonstrate development integration, not live AI behavior.

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

`POST /api/chat` accepts `{"message":"..."}`. Use the question form and Send button at the local web URL. Temporary UUIDs identify responses only; queries and gaps are not saved and `knowledgeGapId` is omitted. Controllers/services depend on AgentProvider; only server composition selects FakeAgentProvider. Draft generation is deferred.

| Example | Result |
| --- | --- |
| ¿Qué tóner utiliza la impresora MX550? | 200 SUFFICIENT with explicitly fictional NX-550 Black toner and synthetic evidence. |
| ¿Cuál es el procedimiento de la empresa para dar de baja una impresora? | 200 INSUFFICIENT with TI / Equipos category, Soporte de TI roles, and three recovery proposals. |
| ¿Cuál es la capital de Francia? | 200 with organizationallyRelevant false; successful domain assessment, not a gap candidate. |
| simular fallo del agente | 503 FAILURE with a sanitized message; trigger enabled only outside NODE_ENV=production. |

Spanish is primary for visible examples, default questions, and demo response text. English aliases remain supported and tested: “What toner does the MX550 printer use?”, “What is the company procedure for retiring a printer?”, “What is the capital of France?”, and “simulate agent failure”. Status values, action types, HTTP behavior, and provider-neutral contracts are unchanged.

Only the small explicit English/Spanish fixture aliases are recognized. Other questions (including greetings and unsupported organizational questions) return the out-of-scope development response; this fake is not a general relevance classifier. It makes no external calls. No proposed action is executed.

**Task-specific contract differences:** this implementation follows the agent-foundation request's `message` input and `evidence` output rather than the provisional `question`/`sources` fields in API_CONTRACTS.md. Responses add status/relevance/suggestions. Successful nonpersistent assessments use 200 rather than the future persisted-query 201. Valid non-organizational questions also return 200: relevance is a domain assessment, not an HTTP validation error. Their structured ChatResponse is preserved, including existing OUT_OF_SCOPE metadata. Provider failures return 503 with a structured ChatResponse and provider-neutral error. Invalid messages/malformed JSON return 400 with only `error`; oversized bodies return 413. Existing `/api/health` is unchanged.

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
