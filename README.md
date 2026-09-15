# BeverageAI DZ

Integrated beverage R&D decision-support platform with ingredient management, formulation calculations, laboratory and sensory workflows, compatibility screening, generated candidates, regulatory/label support, costing and evidence-grounded research.

## Current status

The application uses Supabase Postgres for durable storage and Supabase Auth for user accounts. Formulations, AI variants, compliance results, cost calculations, and target-generation runs are owner-scoped. The ingredient catalog is shared and read-only through the public Data API; application writes go through the authenticated backend. A local JSON fallback remains available by omitting `STORAGE_MODE=supabase`.

## Implemented capabilities

### Data and formulation

- 466 halal-compatible, non-intoxicating beverage ingredients are currently loaded.
- Formulations and their normalized ingredient rows are stored transactionally in Supabase.
- Compatibility is screened on demand from ingredient properties and deterministic rules; the app does not store or claim a precomputed 1.4-million-pair matrix.

### Storage and API

- PostgreSQL indexes support the application’s current ownership and lookup queries.
- Row Level Security and backend authorization isolate owner-scoped records.
- The API includes request validation, rate limiting, pagination, readiness checks, and batch compatibility operations.
- No 100,000-formulation capacity or 500 ms response-time guarantee is claimed because production load benchmarks have not been completed.

### Product features

- Gemini can review formulation candidates and provide opt-in, schema-validated interpretations for laboratory, sensory, regulatory/label, and cost workspaces; deterministic calculations remain authoritative and available if Gemini is unavailable.
- Laboratory results are durable, clickable/editable records with CSV/XLSX import and import-row validation.
- A dedicated Sensory workspace supports controlled study design, blinded and randomized sample presentation, individual panel responses, sensory profiles, confidence intervals, exploratory ANOVA, correlations, segment analysis, JAR penalty analysis, commercial-intent measures, and response-quality diagnostics.
- Algerian regulatory checks and the separate multilingual Label Studio are draft screening tools, not legal certification. Its Recipes, Label Builder, Live Label and Reports tabs cover formulation selection, market/pack data, nutrition, ingredient declarations, allergen-name screening, claims, storage, operator, origin, lot, QR workspace previews, print/PDF and launch-readiness review.
- Cost and ROI scenarios include yield/loss, ingredient waste, primary and secondary packaging, labor, utilities, quality, sanitation, freight, warehousing, fixed overhead, depreciation, financing, marketing, sales commission, distributor/retailer margins, tax, CAPEX, working capital, break-even and payback.
- The Patent & Publication RAG is available as an isolated primary workspace configured with `VITE_RAG_URL`; RAG downtime cannot take down the main application.

### Access and history

- Authenticated accounts have `admin`, `formulator`, or read-only `viewer` roles.
- Administrator bootstrap is tied to one explicitly configured Auth email; signup order never grants privileges.
- Formulations, generated variants, compliance results, and calculations are owner-scoped.
- Formulation version creation and history are supported. This is application-level versioning, not Git-style branching or enterprise document control.
- Organization workspaces, team invitations, billing tenants, and enterprise SSO are not implemented, so the app does not claim full enterprise multi-tenancy. Per-account external-AI request quotas are implemented; they are operational safeguards, not billing plans.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Fastify, Zod
- Database and identity: Supabase Postgres, Auth, Row Level Security

## Quick start

Requirements: Node.js 20.19 or newer and npm.

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
- `NODE_ENV=production` enables fail-closed startup checks: Supabase storage,
  server credentials, and an explicit HTTPS CORS allowlist are required.
- `CORS_ORIGINS` is a comma-separated allowlist and defaults to `http://localhost:5173`.
- `RATE_LIMIT_MAX` defaults to 200 requests per minute.
- `PERSIST_DATA` defaults to `true`; `DATA_FILE` can override the local JSON data path.
- `STORAGE_MODE=supabase` enables Supabase persistence.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` configure the backend. The secret key must never be placed in frontend variables.
- `BOOTSTRAP_ADMIN_EMAIL` is required in production and identifies the Auth account permitted to claim the initial administrator role.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configure browser authentication.
- `VITE_RAG_URL` configures the independently hosted evidence workspace embedded under **RAG Evidence**.
- Setting `API_KEY` requires clients to send the same value in `x-api-key`. Set `VITE_API_KEY` for the frontend when using this option.
- `AI_DAILY_REQUEST_LIMIT` and `AI_MONTHLY_REQUEST_LIMIT` default to 25 and 250 external provider calls per account. The daily limit cannot exceed the monthly limit.

The unauthenticated JSON-file fallback can bind only to a loopback host. It is
rejected when `NODE_ENV=production`; do not use it for shared or deployed
environments. `PERSIST_DATA=false` is also rejected in production.

### Optional AI review

Target-based predictive formulation and the AI Recommendation Engine support the Google Gemini API. The default model is `gemini-3.1-flash-lite`; `GEMINI_FALLBACK_MODELS` configures a short ordered fallback list for transient 404/429/503 provider failures. Model availability, free-tier limits, and data-use terms are controlled by Google and can change.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `GEMINI_API_KEY` in `backend/.env`.
4. Restart the backend.

Provider configuration alone does not send data. Each account must opt in under **Account → AI privacy and quota**. Ingredient names, percentages, calculated nutrition, cost, and local screening results are then sent for conservative review. Formulation names remain redacted unless separately enabled. Ingredient percentages, nutrition, cost, request validation, and configured maximum limits remain server-controlled. Every response states whether Gemini was actually used and reports remaining request quota.

Provider requests use a strict JSON response schema and are validated again with Zod before they can affect results. The application persists provider, model, outcome, and token counts for quota enforcement, but does not persist prompts or provider responses. Failed provider attempts count because they can consume provider capacity. Quota exhaustion, disabled consent, provider errors, and timeouts all fall back to deterministic local generation.

If the key is missing, invalid, rate-limited, or the request times out, generation continues with the local fallback. Provider retention, training, regional processing, and pricing terms are external controls and may change; review the current provider terms before enabling confidential formulation processing.

Do not treat a value embedded through `VITE_API_KEY` as a secret; browser users can inspect it. Production deployments should replace this development API-key option with user authentication and server-side authorization.

## Commands

```bash
npm run dev       # start backend and frontend
npm run build     # validate backend syntax and build the frontend
npm test          # run backend API tests
npm run test:db   # rebuild local Supabase and execute pgTAP RLS tests
```

## CI and production operations

GitHub Actions now validates the application, database migrations, RLS policies, dependency audit, and production container. Published releases apply reviewed Supabase migrations and publish an immutable container image to GitHub Container Registry. A separate scheduled workflow creates encrypted logical database backups.

See `OPERATIONS.md` for environment protection, deployment, rollback, backup restoration, monitoring, alerts, and incident response. See `SECURITY.md` for vulnerability reporting and production access requirements.

The implemented architecture is documented in `ARCHITECTURE.md`. The audited
industrial roadmap, explicit gaps and acceptance criteria are maintained in
`MASTER_PLAN_AUDIT.md`; roadmap capabilities are not represented as shipped.

## API

The API is available under `/api/v1` and covers:

- `/ingredients`
- `/formulations`
- `/compatibility`
- `/ai`
- `/target-generation`
- `/sensory/studies`
- `/formulations/:id/laboratory-results`
- `/regulatory`
- `/cost`

Invalid requests return HTTP 400 with structured validation details. Missing resources return HTTP 404.

## Supabase database

Versioned migrations live in `supabase/migrations`; `backend/database/supabase_schema.sql` is the consolidated schema reference and is not executed directly by an application migration script. Apply schema changes only with the reviewed Supabase CLI/deployment workflow. The migrations include explicit Data API grants, RLS policies, cross-tenant relational constraints, Auth-backed profiles and roles, normalized formulation ingredients, AI results, target runs, compliance, pricing, costs, audit logs, and server-only transaction functions.

The Sensory workspace requires `20260825202029_sensory_studies_and_responses.sql` on the hosted project. A missing table is reported as unavailable instead of silently using temporary browser data. Authenticate the Supabase CLI, link the intended project, inspect `supabase migration list`, then apply reviewed pending migrations with `supabase db push`; never use a remote reset to install this feature.

All ordinary accounts start as `formulator`. Set `BOOTSTRAP_ADMIN_EMAIL` before the intended administrator signs in. The backend asks a service-role-only database function to verify that exact email against `auth.users`; the bootstrap is idempotent for that account and rejects every second identity. Administrators can manage the shared ingredient catalog and other users; `viewer` accounts are read-only.

For local database development, install Docker and run:

```bash
npm run db:start
npm run test:db
```

`db:reset` rebuilds the database from versioned migrations and applies `supabase/seed.sql`. The seed is tenant-neutral: it contains only shared ingredient catalog rows and never creates Auth users, profiles, formulations, or audit records. RLS tests under `supabase/tests/database` create two temporary tenants inside transactions and roll everything back.

Before pushing migrations to a hosted project, review legacy owner-scoped rows. The tenant-integrity migration deliberately stops if any formulation, formulation ingredient, AI variant, compliance record, or batch calculation has a null owner. Assign or remove those rows in a reviewed migration rather than claiming them automatically. Apply schema changes through the deployment pipeline, then run the Supabase security and performance advisors.

For password-reset links, add `http://localhost:5173/account` to Supabase Auth → URL Configuration → Redirect URLs. Use the exact deployed HTTPS account URL in production.

Supabase requests load only the authenticated owner's records. Successful API
mutations are diffed against that request snapshot and committed, together with
their audit event, through one PostgreSQL transaction. The server never loads
all tenants into a shared process-wide store. Legacy rows without an owner are
not exposed or claimed automatically; assign them deliberately during a
reviewed data migration.

## Spreadsheet imports

Lab Results and Sensory Panel Data accept CSV or XLSX. Download the template from the relevant screen. Lab files use one row per batch result. Sensory files use one row per panelist/sample pair and are grouped transactionally by `panelist_code` during import. Invalid rows are rejected with a row number while valid rows are committed to the owner-scoped database.

## Cost model

The MVP assumes one liter of beverage has approximately one kilogram of formulation mass. Ingredient contribution is therefore calculated as:

```text
percentage / 100 × price per kg
```

The scenario engine expands that ingredient basis with saleable yield, raw-material waste, packaging, conversion, QC, sanitation, logistics, warehousing, fixed costs, depreciation, commercial deductions and investment assumptions. Outputs remain planning estimates until supplier quotes, measured line losses and finance assumptions are validated.

## Ingredient catalog methodology

The bundled catalog currently contains 466 beverage-use ingredients selected from beverage-relevant functional classes and ingredient inventories maintained by Codex GSFA, the US FDA, and the European Commission. It excludes intoxicating ingredients and known animal-derived additives such as gelatin, carmine, and shellac. Catalog halal status means the named plant, mineral, microbial, or synthetic source is halal-compatible; procurement must still verify the supplier certificate, processing aids, cross-contamination controls, and exact source.

Bundled DZD/kg values are dated planning estimates, not quotations. They use category benchmarks and an official Bank of Algeria USD/DZD reference of 133.3152, then vary by ingredient class. Replace them through the ingredient editor with current supplier quotes; price changes are recorded and formulations are recalculated automatically.

Research references:

- Codex GSFA: https://www.fao.org/gsfaonline/
- FDA Substances Added to Food: https://www.fda.gov/food/food-additives-petitions/substances-added-food-formerly-eafus
- European Commission food-additive information: https://food.ec.europa.eu/food-safety/food-improvement-agents/additives_en
- Bank of Algeria daily exchange rates: https://www.bank-of-algeria.dz/taux-de-change-journalier/

## Before production

Configure custom SMTP and production redirect URLs for Auth, rotate deployment secrets, and complete load/security testing. Supabase leaked-password protection requires the Pro plan or above; Free-plan deployments should document that limitation and enforce strong password guidance. Scientific calculations and regulatory rules still require qualified domain validation before commercial use.
