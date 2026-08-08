# BeverageAI DZ

Beverage formulation MVP with ingredient management, formulation calculations, compatibility checks, generated variants, regulatory checks, and cost/ROI analysis.

## Current status

The application uses Supabase Postgres for durable storage and Supabase Auth for user accounts. Formulations, AI variants, compliance results, cost calculations, and target-generation runs are owner-scoped. The ingredient catalog is shared and read-only through the public Data API; application writes go through the authenticated backend. A local JSON fallback remains available by omitting `STORAGE_MODE=supabase`.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Fastify, Zod
- Database and identity: Supabase Postgres, Auth, Row Level Security

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
- `PERSIST_DATA` defaults to `true`; `DATA_FILE` can override the local JSON data path.
- `STORAGE_MODE=supabase` enables Supabase persistence.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` configure the backend. The secret key must never be placed in frontend variables.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configure browser authentication.
- Setting `API_KEY` requires clients to send the same value in `x-api-key`. Set `VITE_API_KEY` for the frontend when using this option.

### Free AI review

Target-based predictive formulation and the AI Recommendation Engine support the Google Gemini API. The default model is `gemini-2.5-flash-lite`; model availability, free-tier limits, and data-use terms are controlled by Google and can change.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `GEMINI_API_KEY` in `backend/.env`.
4. Restart the backend.

When configured, target generation and recommendation endpoints send validated candidate summaries to Gemini for conservative review. Ingredient percentages, nutrition, cost, request validation, and configured maximum limits remain server-controlled. Every response states whether Gemini was actually used.

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

## Supabase database

The deployable schema is in `backend/database/supabase_schema.sql`. It includes explicit Data API grants, RLS policies, ownership indexes, Auth-backed profiles, normalized formulation ingredient relations, AI results, target runs, compliance, pricing, costs, and audit logs. Apply schema changes through a reviewed Supabase migration, then run the Supabase security and performance advisors.

On the first authenticated request after importing legacy local data, unowned formulations and related records are assigned to that user. Subsequent records are created with the authenticated user's ID.

## Cost model

The MVP assumes one liter of beverage has approximately one kilogram of formulation mass. Ingredient contribution is therefore calculated as:

```text
percentage / 100 × price per kg
```

Real production costing should incorporate measured density, process loss, packaging, labor, freight, and supplier price history.

## Ingredient catalog methodology

The bundled catalog contains more than 300 beverage-use ingredients selected from beverage-relevant functional classes and ingredient inventories maintained by Codex GSFA, the US FDA, and the European Commission. It excludes intoxicating ingredients and known animal-derived additives such as gelatin, carmine, and shellac. Catalog halal status means the named plant, mineral, microbial, or synthetic source is halal-compatible; procurement must still verify the supplier certificate, processing aids, cross-contamination controls, and exact source.

Bundled DZD/kg values are dated planning estimates, not quotations. They use category benchmarks and an official Bank of Algeria USD/DZD reference of 133.3152, then vary by ingredient class. Replace them through the ingredient editor with current supplier quotes; price changes are recorded and formulations are recalculated automatically.

Research references:

- Codex GSFA: https://www.fao.org/gsfaonline/
- FDA Substances Added to Food: https://www.fda.gov/food/food-additives-petitions/substances-added-food-formerly-eafus
- European Commission food-additive information: https://food.ec.europa.eu/food-safety/food-improvement-agents/additives_en
- Bank of Algeria daily exchange rates: https://www.bank-of-algeria.dz/taux-de-change-journalier/

## Before production

Configure custom SMTP and redirect URLs for Auth, decide whether ingredient editing requires an administrator role, rotate deployment secrets, and complete load/security testing. Scientific calculations and regulatory rules still require qualified domain validation before commercial use.
