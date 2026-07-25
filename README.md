# BeverageAI DZ

Beverage formulation MVP with ingredient management, formulation calculations, compatibility checks, generated variants, regulatory checks, and cost/ROI analysis.

## Current status

The default server uses in-memory mock storage so the complete UI can run without external services. Data created through the API is reset when the backend restarts. PostgreSQL schema, migration, route, and service modules are included as the foundation for a future persistent mode, but they are not yet connected to the default server.

This distinction is intentional: the current application is a functional local MVP, not yet a production or multi-tenant deployment.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Fastify, Zod
- Optional database tooling: PostgreSQL schema and migration scripts

## Quick start

Requirements: Node.js 18 or newer and npm.

```bash
npm install
npm run dev
```

Open:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3001/health

The Vite development server proxies `/api` requests to the backend.

## Configuration

Configuration is optional for local development. To customize it, copy the example files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Important backend settings:

- `HOST` defaults to `127.0.0.1`.
- `CORS_ORIGINS` is a comma-separated allowlist and defaults to `http://localhost:5173`.
- `RATE_LIMIT_MAX` defaults to 200 requests per minute.
- Setting `API_KEY` requires clients to send the same value in `x-api-key`. Set `VITE_API_KEY` for the frontend when using this option.

### Free AI review

Target-based predictive formulation supports the Google Gemini API. The default model is `gemini-2.5-flash-lite`, which Google currently offers on its limited free tier.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `GEMINI_API_KEY` in `backend/.env`.
4. Restart the backend.

When configured, `POST /api/v1/target-generation/generate` sends validated candidate summaries to Gemini for conservative compatibility, sensory, stability, warning, and explanation review. Ingredient selection, percentages, nutrition, cost, and request validation remain local. The response and Target Generation page state whether Gemini was actually used.

If the key is missing, invalid, rate-limited, or the request times out, generation continues with the local fallback. Free-tier prompts may be used by Google to improve its products; do not send confidential formulation data without reviewing the provider's current data-use and pricing terms.

Do not treat a value embedded through `VITE_API_KEY` as a secret; browser users can inspect it. Production deployments should replace this development API-key option with user authentication and server-side authorization.

## Commands

```bash
npm run dev       # start backend and frontend
npm run build     # validate backend syntax and build the frontend
npm test          # run backend API tests
```

## API

The API is available under `/api/v1` and covers:

- `/ingredients`
- `/formulations`
- `/compatibility`
- `/ai`
- `/target-generation`
- `/regulatory`
- `/cost`

Invalid requests return HTTP 400 with structured validation details. Missing resources return HTTP 404.

## PostgreSQL development

PostgreSQL is not required for the current mock server. To inspect or develop the future persistent implementation:

```bash
createdb beverageai_dz
cp backend/.env.example backend/.env
npm run migrate --workspace=backend
```

Running this migration creates the schema but does not switch the active server away from mock storage.

## Cost model

The MVP assumes one liter of beverage has approximately one kilogram of formulation mass. Ingredient contribution is therefore calculated as:

```text
percentage / 100 × price per kg
```

Real production costing should incorporate measured density, process loss, packaging, labor, freight, and supplier price history.

## Before production

Persistent storage, migrations with version tracking, real identity and tenant authorization, audit logs, deterministic scientific models, jurisdiction-reviewed regulatory rules, and load/security testing are still required.
