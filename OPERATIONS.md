# Operations Runbook

This runbook is the production baseline for BeverageAI DZ. Assign named owners for the application, database, security, and incident-response roles before launch.

## Environments and releases

Use separate Supabase projects and secrets for staging and production. Never modify a hosted schema through the Dashboard after migrations are established. Pull requests run application tests, a clean Supabase reset, pgTAP RLS tests, security advisors, and a production-image smoke test.

Production releases are manual or originate from a published GitHub release. Protect the `production-database`, `production-application`, and `production-backup` GitHub environments with required reviewers. Configure:

- Repository variable `SUPABASE_PROJECT_ID`.
- Production application variables `VITE_SUPABASE_URL` and the public API origin when it differs from `/api/v1`.
- Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Runtime secrets and settings from `backend/.env.example`, including `SUPABASE_SECRET_KEY`, `BOOTSTRAP_ADMIN_EMAIL`, `METRICS_TOKEN`, and `CORS_ORIGINS`.

The release workflow validates the application, previews and applies migrations, runs database security advisors, and publishes an immutable SHA-tagged container to GitHub Container Registry. Configure the hosting platform to deploy that SHA tag; do not deploy `latest` as the immutable release reference.

For a single-host deployment, copy the environment file outside the repository, restrict it to the service account, terminate TLS at a trusted reverse proxy, and run:

```bash
APP_IMAGE=ghcr.io/OWNER/REPOSITORY:sha-COMMIT docker compose -f compose.production.yaml up -d
```

Only add proxy IPs or CIDRs to `TRUST_PROXY`. The Compose port binds to loopback by default so a TLS reverse proxy remains the public entry point.

## Deployment safety and rollback

1. Confirm the latest CI and backup jobs succeeded.
2. Inspect the migration dry-run and resolve null-owner migration failures explicitly.
3. Deploy database changes before an application that depends on them; migrations should remain backward compatible during rolling releases.
4. Verify `/health`, `/ready`, sign-in, one tenant-owned read, and one non-destructive write.
5. Watch error rate, latency, memory, authentication failures, and database resource usage for at least 30 minutes.

Application rollback means redeploying the previous immutable image. Database migrations are forward-only: correct a bad migration with a new reviewed migration. For destructive or irreversible schema work, use an expand/migrate/contract sequence across releases.

## Backups and recovery

Paid Supabase projects receive managed daily database backups; enable Point-in-Time Recovery when the required recovery point objective is shorter than one day. Free projects require independent logical backups. Database backups do not contain Storage API objects, so configure a separate versioned object backup if Storage is introduced.

The scheduled backup workflow creates role, schema, and data dumps, encrypts them with AES-256/PBKDF2 before upload, stores only the encrypted artifact, and retains it for 14 days. Configure the protected `production-backup` environment with:

- `BACKUP_DATABASE_URL`: a TLS-enabled session-pooler or direct database URL dedicated to backup operations.
- `BACKUP_ENCRYPTION_PASSPHRASE`: a randomly generated secret of at least 32 characters, escrowed outside GitHub as well.

Target baseline: daily backups, RPO of 24 hours, and a documented RTO of 4 hours. Enable PITR and adjust these targets for stricter business requirements.

Perform a quarterly restore drill into an isolated, empty Supabase project:

1. Download an encrypted artifact and verify `SHA256SUMS`.
2. Decrypt into an encrypted temporary workstation or isolated CI runner.
3. Restore roles, schema, then data using the official Supabase restore procedure.
4. Apply any migrations created after the backup.
5. Run RLS tests and application smoke tests against the isolated project.
6. Record duration, data gaps, failures, and corrective actions; destroy the drill project and plaintext files.

Never rehearse restoration against production. Restoring a hosted backup causes downtime and must use an approved incident change.

## Observability and alerts

- `/health` is a dependency-free liveness check and exposes no secrets or database URL.
- `/ready` checks the active database and returns HTTP 503 when it is unavailable.
- `/metrics` emits Prometheus text and requires `Authorization: Bearer $METRICS_TOKEN`.
- Every response includes `x-request-id`; a safe caller-provided ID is preserved for cross-system correlation.
- JSON logs redact authorization, cookies, API keys, passwords, tokens, and provider secrets.

Recommended initial alerts:

- Readiness failure for two consecutive minutes.
- HTTP 5xx rate above 2% for five minutes.
- p95 request latency above 1 second for ten minutes.
- Container restarts, memory above 85%, or disk pressure.
- Supabase CPU, memory, connection, or disk utilization above 80%.
- Backup workflow failure or no successful backup within 26 hours.
- Repeated authentication failures, rate-limit spikes, or unexpected administrator changes.
- External-AI quota exhaustion spikes, provider failure outcomes, or sudden token-volume changes.

Logs and metrics must inherit the tenant restrictions of production data. Do not log request bodies, access tokens, AI prompts containing proprietary formulations, or full database records.

AI usage events contain only tenant ID, request ID, operation, provider, model, outcome, and token counts. They never contain prompt or response content. Review retention requirements for these metadata rows and provider-side retention separately. Users can disable future external processing at any time; deterministic local generation remains available.

## Incident response

1. Declare severity and assign incident commander, communications lead, and investigator.
2. Preserve relevant request IDs, audit events, deployment SHA, and provider logs without copying sensitive payloads into chat.
3. Contain: revoke sessions when needed, rotate exposed credentials, disable compromised integrations, or roll back the application image.
4. Recover from the smallest trustworthy point and verify tenant isolation before reopening traffic.
5. Notify affected users and regulators according to applicable contractual and legal deadlines.
6. Complete a blameless post-incident review with tracked remediation.

Rotate `SUPABASE_SECRET_KEY`, database passwords, Gemini keys, metrics tokens, backup secrets, and GitHub tokens after suspected exposure. Browser publishable keys are not secrets, but their allowed origins and RLS protections still require review.
