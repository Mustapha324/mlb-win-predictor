# Security policy

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit instructions against a live deployment, private user data, or unredacted logs. Use the repository's **Security → Advisories → Report a vulnerability** entry when private vulnerability reporting is enabled. If it is unavailable, ask the maintainer for a private reporting channel without disclosing the vulnerability publicly. No dedicated security email or response-time guarantee is currently configured.

Include the affected commit, component, impact, minimal reproduction on a local/disposable deployment, and a suggested mitigation when available. Redact tokens, cookies, emails, and account identifiers. Do not access other users' accounts or test against production without the operator's explicit permission.

## Security boundaries

- Predictions and model information are public; authentication enables personal and social actions.
- Sensitive profile/authentication data is not part of public profiles. Public responses use an explicit field allowlist.
- Users may edit only their own profile and eligible picks. PostgreSQL enforces pick deadlines and relationship authorization in addition to the API.
- Pick-time predictions are immutable snapshots. Only trusted final-results processing may grade picks.
- Supabase admin keys stay on the server and are read only through `frontend/lib/supabase/admin.ts`.
- Authenticated mutations must resist cross-site requests; sessions are validated server-side.
- Cron endpoints require `CRON_SECRET`. Paid external odds fetching remains optional and can be disabled with `DFS_BOARDS=off`.

## Credentials and publication

Use `.env.example` for variable names; store real values only in ignored local files or the deployment provider's secrets manager. `.gitignore` cannot erase earlier commits. Rotate or revoke an exposed secret before publishing, even if the file has been deleted from the current branch.

The transition audit and specific publication blockers are recorded in [docs/open-source-transition.md](docs/open-source-transition.md). That audit covers a local snapshot and is not a certification of the production infrastructure or every remote copy of Git history. Operators must verify key rotation, migrations, existing deployments, and repository-hosted artifacts before changing visibility.
