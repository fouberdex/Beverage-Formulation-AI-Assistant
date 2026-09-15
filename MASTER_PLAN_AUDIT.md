# BeverageAI industrial platform — repository audit and delivery plan

Audit date: 2026-09-14  
Working branch: `Industrial-R&D-Platform`

This document maps the master product brief to the repository. A capability is
called implemented only when a persisted workflow and relevant automated tests
exist. Roadmap items are not product claims.

## 1. Current-state architecture map

| Layer | Implemented responsibility | Main locations |
| --- | --- | --- |
| Web application | React routes, role-aware navigation, AKA-style design system, spreadsheet imports | `frontend/src` |
| API | Fastify routes, Zod validation, authorization, rate limits, observability | `backend/src/routes`, `backend/src/services` |
| Persistence | Request-scoped Supabase repositories, atomic changed-row commits, audit events | `backend/src/data`, `supabase/migrations` |
| Identity/security | Supabase Auth, owner isolation, RLS and admin bootstrap | `frontend/src/auth`, `backend/src/services/authorization.js` |
| Deterministic engines | Formulation math, compatibility, regulatory screening, costing, sensory statistics | `backend/src/services` |
| Optional AI | Opt-in Gemini review with quotas, schema validation and local fallback | `backend/src/services/geminiService.js`, `aiGovernance.js` |
| Evidence workspace | Independent Streamlit/Qdrant/Ollama-or-GPU RAG | `innovation-rag` |

## 2. Capabilities already present

- Shared ingredient catalog with controlled edits and price history.
- Owner-scoped formulation CRUD, deterministic calculations and parent versions.
- Laboratory result CRUD, archive, CSV/XLSX import and sensory summary linkage.
- Sensory study design, blind codes, serving randomization, panel import and
  descriptive/ANOVA/JAR/segmentation diagnostics.
- Compatibility, regulatory screening and multilingual saved label drafts.
- Expanded manufacturing cost, ROI and scenario calculations.
- Target candidate generation and candidate acceptance workflow.
- Consent-controlled Gemini assistance with safe fallbacks.
- Audit history, role checks, Supabase RLS and transactional persistence.
- FoodIQ evidence retrieval, citations, evidence gating, diagnostic traces and
  chemistry guardrails.

## 3. Partially implemented capabilities

| Domain | Present | Missing for industrial completion |
| --- | --- | --- |
| R&D lifecycle | Formulations, lab, sensory and history exist | Unified project, milestones, decisions and cross-domain timeline |
| Formulation intelligence | Targets and deterministic calculations | General constraint solver, Pareto frontier and reproducibility manifest |
| Laboratory | Configurable measurements and imports | Lab batch procedure, equipment, material lots, attachments and deviations |
| Sensory | Strong single-study analytics | Panelist registry, triangle tests, post-hoc comparison and cross-formula maps |
| Ingredients | Catalog, attributes and price | Multiple suppliers, qualification, certificates and revisions |
| Regulatory | Preliminary rule checks and labels | Versioned jurisdiction rule packs, source/change governance and approvals |
| Cost | Broad deterministic scenario | Supplier-specific quotes, packaging objects and historical scenario comparison |
| FoodIQ | Standalone and embedded workspace | Structured context handoff from each operational record |
| Governance | Admin/formulator/viewer and audit | Expanded industrial roles and immutable approval decisions |

## 4. Missing capabilities

- DOE design and deterministic model-analysis workspace.
- Stability/shelf-life programs and trend analysis.
- Finished-product specification and controlled revision workflow.
- Suppliers, raw-material lots, qualification and document ingestion.
- Packaging as a first-class object.
- Scale-up and industrial production trials.
- Batch QC/release, out-of-specification handling, deviations and CAPA.
- Complaints and field intelligence.
- Product Digital Passport and global safe structured search.
- Validated next-best-experiment/predictive model registry.

## 5. Technical debt and blockers

1. Current records are connected mainly through formulation IDs; a project and
   formulation-version spine is required before adding more modules.
2. The request repository will become unwieldy if all future domains are added to
   one payload/commit function.
3. Regulatory knowledge is screening logic, not a governed rule-pack service.
4. FoodIQ's free local model path is resource-constrained; temporary GPU tunnels
   are not a dependable production deployment.
5. No validated load benchmark exists, so capacity/latency promises are blocked.
6. Docker/database integration tests require Docker on the executing machine.

## 6. Required database evolution

The next schema changes should be additive and owner-scoped:

- `rd_projects`, `project_members`, `project_milestones`, `project_decisions`
- immutable `formulation_versions` plus links from lab and sensory records
- `experiments`, `experiment_factors`, `experiment_runs`, `experiment_responses`
- `lab_batches`, material lots, procedure steps and attachments
- `stability_studies`, `stability_timepoints`, `stability_measurements`
- `product_specifications`, `specification_revisions`, `approval_events`
- `suppliers`, `supplier_materials`, `material_specifications`, `documents`
- `packaging_components`, `packaging_configurations`
- `production_trials`, `qc_results`, `deviations`, `capa_actions`, `complaints`

Every child table needs an owner/project relationship protected by composite
foreign keys and RLS. Approval events must be append-only. Original documents
and extraction provenance must remain immutable.

## 7. Phased implementation plan

### Phase 0 — stabilization (completed)

- Keep CI/build/API/browser checks green.
- Maintain one executable migration chain and prove hosted alignment.
- Remove unvalidated architecture/capacity claims.
- Apply one visual system to every current route and nested control.
- Keep FoodIQ isolated and add deterministic health/fallback behavior.

### Phase 1 — closed R&D loop

- Add the unified project, decision and milestone model. **Foundation delivered:** owned projects, explicit stages, controlled transitions and append-only event trail.
- Introduce immutable formulation versions.
- Link experiments, lab results and sensory studies to project/version.
- Add project overview, lifecycle timeline and cross-module navigation.
- Preserve current standalone workflows during migration.

Phase 1 is intentionally being delivered in reviewable tranches. Tranche 1 added
the project portfolio and lifecycle without changing existing formulation, lab or
sensory records. Tranche 2 now adds a validated, measurable project brief, locks
approved formulation versions, and carries the project plus exact formulation
version through laboratory and sensory records. Existing standalone records remain
valid through nullable additive links.

Tranche 3 closes the first operational project loop: a formulator can define a
controlled experimental plan against an exact formulation version, schedule and
track pilot batches, manage measurable lifecycle milestones, and record append-only
Go/No-Go decisions with evidence references. All four registers are owner/project
scoped, protected by composite foreign keys and RLS, and feed the attributed project
timeline. Full deterministic DOE generation and statistics remain Phase 3 work.

### Phase 2 — formulation intelligence

- Build a deterministic constraint schema and feasibility solver.
- Add reproducible multi-objective optimization and Pareto comparisons.
- Report assumptions and every satisfied/violated constraint.

Tranche 1 is now implemented. The local engine uses a versioned, signed input,
performs a feasibility preflight, generates candidates without randomness, and
publishes a constraint ledger with measured values, margins, failures and explicit
`not_evaluable` laboratory gaps. Required/forbidden ingredients, ingredient bounds,
composition total, ingredient count, sugar, calories, ingredient cost, juice,
preservative and caffeine limits are deterministic. pH and sodium are never inferred
from incomplete catalog data. Multi-objective candidates are marked on a Pareto
frontier, linked to an optional validated project and exact reference version, and
saved from the server-owned generation run with engine/signature provenance. Gemini
is advisory-only and cannot alter feasibility, constraint results or Pareto rank.

### Phase 3 — DOE and next experiment

- Deterministic design generators, linked runs, ANOVA, diagnostics and response
  surfaces; recommend the next run only from the recorded design/data.

Tranche 1 is now implemented without a risky schema change: signed full-factorial
and face-centred response-surface matrices are stored in the existing controlled
experimental-plan JSONB, while server-owned factor settings and measured responses
are persisted on their exact pilot batches. A design becomes immutable after its
first linked run. The local engine calculates coefficients, ANOVA sums of squares,
R², adjusted R² and RMSE. Model F-test p-values are calculated only with residual
degrees of freedom; pure error and lack of fit remain explicitly `not_evaluable`
until replicated factor settings and enough distinct design points exist. A
prediction grid supports one-factor curves and two-factor response-surface heatmaps,
and the full signed matrix, measurements, diagnostics and next-run decision can be
exported as an auditable CSV. The engine recommends only an unexecuted run from the
signed matrix, using a fitted model only when sufficient recorded observations exist
and deterministic standard order otherwise. Inferential claims remain blocked until
replication and lack-of-fit gates pass, and domain review is always required.

### Phase 4 — stability and specifications

- Timepoint programs, acceptance limits, deterministic trends, controlled product
  specifications and approval history.

Tranche 1 is now implemented as a controlled, evidence-linked workflow. Stability
programs are attached to an exact project and formulation version and define signed
conditions, timepoints, replicates and parameter limits. Once the first observation
is recorded, the protocol is locked. Observations can only snapshot measurements
from an existing laboratory result linked to that same formulation version; the
client cannot inject replacement values. The deterministic engine reports observed
linear trends, R², limit status, first observed failure and program completion, but
never extrapolates shelf life beyond recorded timepoints. Product specifications are
versioned, remain editable only as drafts and become immutable after approval. Each
approval is append-only, records its evidence and rationale, and supersedes any
previous approved version for the formulation. All four records participate in the
same tenant-isolated Supabase commit and RLS model as the rest of the R&D project.

### Phase 5 — suppliers, documents and packaging

- Supplier qualification, supplier-material facts, document provenance/OCR review
  and packaging configurations linked to cost and stability.

Tranche 1 is now implemented with six tenant-isolated records: supplier
qualification, supplier-specific material references, versioned material
specifications, controlled document metadata, packaging components and packaging
configurations. Documents preserve an immutable SHA-256 identity and controlled
storage reference; a pending document can be reviewed once, after which a revision
must be registered rather than silently replacing its audit state. Packaging
configurations reference an exact project formulation version and are calculated by
a deterministic server-side engine using component cost, mass, recycled content,
barrier data and recorded stability coverage. Warnings cannot disappear during
approval: they must either be resolved or explicitly accepted with rationale and
evidence references. Approved material specifications and packaging configurations
are immutable and superseded only through a new version.

### Phase 6 — industrialization and quality

- Scale-up, production trials, QC release, OOS, deviation and CAPA workflows.

Tranche 1 is now implemented as a controlled industrial release loop. Production
trials reference one exact project, approved formulation version and optional
approved packaging configuration; supplier-material lots, signed critical process
limits, planned volume, saleable output, reject volume, mass-balance loss, yield and
scale factor are persisted together. Completed and cancelled trials are immutable.
QC decisions are calculated server-side from an approved finished-product
specification and laboratory results tied to the same formulation version, then
stored as append-only release records. An out-of-specification result automatically
opens a linked quality event. Deviations and nonconformances can also be opened
manually, investigated and linked to corrective or preventive actions. Closure is
blocked until root cause and disposition are recorded and every active CAPA has an
effectiveness decision. Tenant-scoped composite foreign keys and RLS prevent
cross-project or cross-owner evidence links; authenticated browser clients remain
read-only while the server-owned transactional commit persists the workflow.

### Phase 7 — Product Digital Passport

- Read-optimized cross-domain product view, traceability graph and safe structured
  global search.

Tranche 1 is now implemented without creating a second source of truth. Every
project response includes a read-only passport calculated from the current
tenant-owned records. Ten explicit evidence gates report readiness without claiming
regulatory certification; unresolved major/critical events or unresolved OOS
decisions block readiness, while closed investigations remain visible history rather
than permanent blockers. The graph uses namespaced nodes and explicit relationships
from formulation versions through laboratory, sensory, pilot, stability,
specification, packaging, production, QC and CAPA records. Users can export the
calculated passport as JSON. Structured workspace search is tenant-scoped,
deterministic and limited to selected metadata fields; it never returns generic
payloads or searches extracted document text.

### Phase 8 — validated advanced AI

- Model registry, datasets, evaluation, applicability boundaries and uncertainty;
  no predictive claim before validation criteria pass.

## 8. Branch strategy

The active work already uses `Industrial-R&D-Platform`, not `main`. Preserve a
tested demo commit/tag before Phase 1. Use reviewable branches such as
`feature/rd-loop`, `feature/formulation-optimizer`, `feature/doe-engine`,
`feature/stability`, `feature/suppliers-packaging`, `feature/industrial-quality`
and `feature/product-passport`. Apply migrations through reviewed pull requests.

## 9. Main risks

- Adding isolated modules before the project/version spine would create more
  disconnected data and expensive migrations.
- Unreviewed supplier, regulatory or AI output could be mistaken for authority.
- Statistical features can look credible with insufficient design or sample size;
  outputs need explicit applicability warnings.
- Approval/history records must not be mutable through generic CRUD endpoints.
- Large uploads require storage policies, malware scanning, retention and access
  controls before production use.
- A temporary GPU tunnel is unsuitable as an enterprise RAG dependency.

## 10. Acceptance criteria

### Phase 0

- Production build succeeds.
- Backend unit/API/security suite is green.
- Playwright critical routes and accessibility suite are green.
- Supabase dry-run reports no pending/duplicate migrations.
- Real smoke test proves create/read/update persistence for each current critical
  workflow and cleans its fixtures.
- Documentation contains no unsupported capacity, scientific-optimum or legal-
  certification claim.
- Every current route, nested tab, form control, table and state message uses the
  shared visual system.

### Phase 1

- A user can create a project from a validated brief and see its current stage.
- A formulation version is immutable after a recorded approval decision.
- Experiment, lab and sensory records reference the same project and exact
  formulation version.
- The project timeline attributes every material event to a user and timestamp.
- Cross-owner links fail at both API and database levels.
- Existing formulation/lab/sensory records remain usable during migration.
- Unit, API, RLS and E2E tests cover creation, linkage, permissions, history and
  failure behavior.
