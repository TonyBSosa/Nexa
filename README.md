# NEXA

NEXA is an organizational knowledge intelligence concept that turns questions and missing knowledge into human-approved, reusable documentation. See [the project brief](docs/PROJECT_BRIEF.md) for product scope.

## Current Stage

Technical bootstrap only: a minimal React page, Express health endpoint, and shared HealthResponse type. Botpress, SQLite persistence, Knowledge Gaps, product workflows, authentication, final UI, Tailwind/shadcn, and Docker are not implemented.

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

## Validation and Builds

```sh
npm run lint
npm run typecheck
npm run build
```

Lint covers all workspaces and root JavaScript configuration. Typecheck uses strict TypeScript. Build compiles shared contracts and API, then bundles the web app. Output is in each workspace's ignored `dist/` directory.

After building, run the compiled API with `npm run start -w @nexa/api`. Preview the frontend with `npm run preview -w @nexa/web`; the development health button/proxy is not part of this production preview. No product/business-logic tests exist at this bootstrap stage; add them when implementing that logic.

If a port is occupied, stop the conflicting local server or configure a different API port. Vite fails on a busy 5173 rather than silently changing the documented URL. In PowerShell environments that block npm.ps1, use `npm.cmd` for the same commands. Stop development servers with Ctrl+C.
