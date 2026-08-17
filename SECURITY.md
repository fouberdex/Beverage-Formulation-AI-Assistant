# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it privately to the repository owner through GitHub Security Advisories or the organization's designated security contact. Include affected versions, reproduction steps, impact, and any request IDs; do not include real credentials or customer data.

## Operational requirements

- Protect `main`, require CI, review migration changes, and require approval for production GitHub environments.
- Grant GitHub, Supabase, hosting, and monitoring access through individual least-privilege accounts with MFA.
- Keep service-role, database, AI, backup, and metrics credentials only in approved secret stores.
- Never place secret keys in `VITE_*` variables or container build arguments. Only Supabase publishable keys belong in browser builds.
- Review Dependabot updates and respond immediately to critical vulnerabilities.
- Rotate secrets after staff changes, suspected exposure, or provider incidents.
- Review Supabase Auth redirect URLs, RLS policies, advisors, audit logs, and administrator accounts before each production launch.

Supported production releases are the currently deployed immutable image and the immediately previous release during rollback. Security fixes should be released as a new image and migration set; production files must not be patched manually.
