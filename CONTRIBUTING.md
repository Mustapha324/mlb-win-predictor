# Contributing to SportIQ

SportIQ's model comes first: predictions, user picks, comparison with the model, then social context. Predictions must remain free and usable without an account.

## Start here

Read [AGENTS.md](AGENTS.md), [docs/MAP.md](docs/MAP.md), and the relevant source before editing. The map is orientation, not a substitute for checking current code. Open an issue for a bug or a focused proposal. Discuss model changes, new data providers, or substantial schema changes before investing in a large implementation.

1. Fork the repository when public and clone your fork.
2. Branch from the latest `main`, using `feat/short-description`, `fix/short-description`, or `docs/short-description`.
3. Install Node.js 22.13 or newer, then run `npm ci` in `frontend/`.
4. Copy `frontend/.env.example` to `frontend/.env.local`. Leave optional credentials blank for public prediction development.
5. Run `npm run dev` from `frontend/`, then open `http://localhost:3000`.

The owner's `codex/*` branches are reserved agent lanes. Do not push to them. Send a pull request from your branch to `main`; do not rewrite another contributor's branch. Data from live capture belongs on `live-snapshots`, never in a code PR.

## Scope and conventions

- Keep changes focused; preserve the existing Next.js App Router architecture, TypeScript types, shared sport-neutral UI, and dark theme.
- Keep database access and sensitive logic on the server. New modules in `frontend/lib/server/` begin with `import "server-only"`.
- Access admin credentials through `frontend/lib/supabase/admin.ts`. Never add a service key to a public variable or return it in JSON.
- Use SQL migrations for schema changes. Preserve historical records; never loosen ownership checks, RLS, or database pick deadlines.
- Preserve model snapshots captured at pick time. Read sports dates from the trusted feed, not the browser.
- Handle missing credentials and upstream API errors with clear, safe states. A public prediction route cannot require an account.
- Use accessible labels, keyboard controls, responsive layouts, and useful loading/empty/error states.
- Do not commit populated environment files, local databases, dependency folders, agent state, or generated build output. Review `git diff --cached` before committing.

## Required verification

From `frontend/`:

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

For UI/API changes, start the development server, walk the affected flow, and inspect the returned JSON. For authentication/social changes, test with a local or staging Supabase project and at least two users: ownership, friendship transitions, late picks, edits/deletes after lock, tail snapshots, grading, and public response privacy. Never run destructive tests against production.

The deterministic browser suite uses mocked social responses and real UI components. Start `npm run dev -- --port 3100` in one terminal, then in another terminal in `frontend/` run:

```sh
npx playwright install chromium
npm run test:ui
```

Set `SPORTIQ_TEST_URL` to test a different local port. On Windows, an installed Edge browser can be used by setting `PLAYWRIGHT_CHANNEL=msedge` instead of downloading Chromium. These tests cover the UI contract; they do not validate hosted Supabase authentication or email delivery.

From the repository root, the dependency-free backend training safeguards run with:

```sh
python -m unittest discover -s backend/tests -v
```

`npm test` executes migrations in timestamp order in an isolated PGlite PostgreSQL database with simulated Supabase auth roles. It verifies RPC authorization, table grants, pick deadlines, snapshots, grading and statistics. Also validate against a disposable Supabase project before production: the embedded harness does not exercise the hosted auth gateway, email delivery or the retired invite extension.

For every model factor/weight change, also run `npm run backtest` against the configured baseline, require holdout non-degradation, and append the outcome to [docs/backtests/experiments.md](docs/backtests/experiments.md). That ledger is append-only, including rejected experiments. Do not hand-tune `DEFAULT_BRAIN_WEIGHTS` in a feature PR. Generated training artifacts must come from their trainer, not manual edits.

## Pull requests

Explain the user-visible problem, the resulting behavior, and the checks actually run, including numbers and failures. Include screenshots for visible changes and migration/rollout notes for database changes. Call out anything unverified. Update documentation when commands, routes, configuration, or privacy rules change.

Never attach real user data or secrets to issues, screenshots, logs, or test fixtures. Report vulnerabilities using [SECURITY.md](SECURITY.md). Contributions are distributed under the project's [MIT License](LICENSE); third-party data and assets retain their own terms.
