# BeverageAI DZ architecture

This document describes the implemented system as of 2026-09-14. Target-state
capabilities are tracked separately in `MASTER_PLAN_AUDIT.md`; they are not
presented here as shipped features.

## Runtime map

```text
React/Vite browser application
  ├─ Supabase Auth (browser session)
  ├─ Fastify API /api/v1 (bearer token + role checks)
  │    ├─ request-scoped repositories
  │    ├─ deterministic domain services
  │    ├─ optional, consented Gemini reviews
  │    └─ atomic Supabase commit RPC + audit event
  └─ isolated FoodIQ iframe
       ├─ Streamlit user interface
       ├─ Qdrant hybrid/sparse retrieval
       ├─ evidence policy and chemistry guardrails
       └─ local Ollama or configured remote OpenAI-compatible model

Supabase Postgres
  ├─ shared ingredient catalog
  ├─ owner-scoped formulation and validation records
  ├─ laboratory and sensory records
  ├─ AI governance/usage metadata (no stored prompts or responses)
  └─ row-level security and server-only transactional functions
```

The main application and FoodIQ have separate failure boundaries. FoodIQ or a
GPU tunnel can be unavailable without making the formulation application
unavailable.

## Authoritative runtime entrypoints

- `backend/src/server.js` is the only Node API entrypoint and currently owns the
  registered Fastify routes while domain behavior lives in the deterministic
  services imported by that file.
- `frontend/src/main.tsx` is the browser entrypoint.
- `innovation-rag/app/streamlit_app.py` and `beverage_rag.cli` are the isolated
  FoodIQ entrypoints.
- Database evolution is performed only by the versioned files in
  `supabase/migrations` through the Supabase CLI and deployment workflow.

The former Express-style route/service stack and direct `pg` schema runner were
removed after import tracing confirmed that the active Fastify server did not
register them. This prevents the randomized legacy target generator and parallel
SQL implementations from being mistaken for authoritative domain behavior. The
consolidated files under `backend/database` remain schema references, not migration
entrypoints.

## Implemented domain boundaries

- `ingredients`: shared catalog, administrator-controlled changes and pricing.
- `formulations`: composition, deterministic nutrition/cost calculation,
  parent-version linkage and owner isolation.
- `laboratory`: persisted measurements, edits, archive workflow and CSV/XLSX
  import.
- `sensory`: study design, blind codes, serving randomization, panel responses,
  imports and deterministic statistics.
- `compatibility`: deterministic screening from configured ingredient facts.
- `regulatory`: jurisdiction-oriented preliminary screening and saved results.
- `labels`: multilingual internal label drafts and review readiness; it is not
  legal certification.
- `costing`: deterministic manufacturing scenarios, margin, investment,
  break-even and payback calculations.
- `project state`: selects one target formulation version and calculates the
  current stage, next controlled action, blockers, exact-version evidence chain,
  readiness, reformulation assessment and release eligibility from persisted
  records only. Reformulation is an explained decision object: only an explicit
  target-version rework decision makes it mandatory; stability, pilot, process,
  packaging and quality signals route to the relevant investigation first. The
  frontend consumes this contract and limits its adaptation to display labels and
  routes; it does not independently infer workflow state.
- `ai`: explicit per-user opt-in, quotas, strict output schemas and deterministic
  fallback. AI output cannot replace authoritative calculations.
- `research intelligence`: isolated patent/publication RAG with evidence gates.

## API and trust boundaries

The Fastify API validates request bodies with Zod. Supabase JWTs establish the
user identity; backend authorization checks the current role. Data repositories
load only records visible to the current owner. Mutations are diffed and written
with an audit event through a transaction function.

The browser never receives the Supabase secret/service key or Gemini API key.
External AI processing is disabled until the account opts in. Provider requests
omit unnecessary identity fields by default, use a strict JSON response schema,
and record only operational usage metadata. Formulation reviews expose qualitative
stability risks, possible failure modes, recommended tests, evidence gaps and
uncertainty; the provider contract contains no numeric shelf-life or validated
storage-duration field.

Label shelf-life evidence is calculated server-side from exact-version stability
programs and observations. Observed coverage includes recorded timepoints, while
validated coverage includes only completed, fully observed programs without a
declared-limit failure. The label gate never extrapolates beyond recorded days.

Sensory inferential statistics respect the panel structure. A complete balanced
panel uses randomized complete block ANOVA with panelist as block, accompanied by a
Friedman rank test. Incomplete or unbalanced repeated measures are returned as
descriptive-only because the platform does not currently fit mixed-effects models.

## Persistence model

Supabase is the supported shared/deployed persistence mode. A JSON/in-memory
store exists only for loopback development and automated tests and is rejected
in production. Versioned migrations, explicit grants, RLS policies, composite
owner foreign keys and pgTAP integration tests define the database contract.

Historical no-op migration markers align a hosted project's earlier migration
identifiers with consolidated idempotent local migrations. They must not be
removed or filled with duplicate schema SQL.

## Deployment

The supported product is browser-based and containerized. It can be deployed as
hosted SaaS, private cloud or on-premise. Production startup fails closed unless
Supabase, secure CORS, authentication and operational controls are configured.
The Docker image runs as an unprivileged user and exposes health/readiness
endpoints.

## Honest limits

- No throughput, latency or maximum-dataset claim is made without a benchmark.
- Compatibility and regulatory outputs are screening decisions, not laboratory
  validation or legal certification.
- Generated formulations are feasible candidates for validation, not guaranteed
  scientific optima.
- Sensory and statistical outputs describe the supplied data; they do not imply
  consumer-market validity outside the study design.
- The Product Digital Passport is a calculated exact-version projection of the
  authoritative project state. It must not combine evidence from different
  formulation revisions and is not a regulatory certificate.
- Predictive shelf-life extrapolation and validated advanced-AI claims remain roadmap
  capabilities until their acceptance criteria and validation datasets are complete.

## Engineering rules

Business calculations belong in backend domain services, not React components.
API boundaries require schemas. Safety, regulatory thresholds, approvals,
permissions and release decisions remain deterministic. New major domains need
unit/API/database/RLS/E2E tests and reviewed migrations before navigation links
are exposed.

Material-specification approval is evidence-gated at the API boundary. A caller
must provide a rationale and identifiers for accepted controlled documents linked
to the exact supplier material; free-form or generated evidence identifiers are
rejected. Reviewer identity and approval time are server-derived. These fields are
stored in the existing JSON payload, so this control requires no schema migration.
