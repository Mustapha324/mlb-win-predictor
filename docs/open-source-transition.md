# SportIQ transition, deployment and publication checklist

Implementation/audit date: 2026-09-16. The application is prepared locally; production database migration, credential rotation, Stripe shutdown, deployment and GitHub visibility changes are operator steps. Do not treat a successful build as proof those external steps happened.

## What changed

All prediction/model features are public. Removed paid feature checks, overlays, upgrade links, checkout/billing actions, the Stripe webhook, the Stripe dependency, and invite redemption from the active app. Old `/pro` bookmarks redirect. Existing billing records and original migrations are preserved; the new migration revokes the retired redemption function.

Optional accounts support profiles, pick records, personal analytics/model comparison, friends, tailing, a pick activity feed, and sample-qualified leaderboards. Public profiles expose explicit fields, never email, account UUIDs, billing columns or credentials. Existing/new accounts get a random default username and can edit it in My Profile. Avatars use selectable icons.

Picks use authoritative server game data, one selection per user/game, an immutable model snapshot, and PostgreSQL deadline enforcement. Browser writes cannot bypass the server lookup. Deadline checks occur after row locks using database wall-clock time. A later reschedule cannot reopen an earlier deadline. Tails retain the source selection/attribution independently. Final results grade WIN/LOSS/PUSH/VOID and refresh cached records; missing games/results remain pending for retry.

Accepted friends can view pregame picks. Other users see locked picks; community consensus counts locked picks only. Accuracy excludes pushes/voids. Model comparisons cover the user's own graded games. Leaderboards require 20 wins/losses in the selected category and rank by win percentage, sample size, then username. The feed contains pick activity and results; synthetic daily/streak announcements are not implemented.

Latest main's sportsbook lines, market anchoring, NFL eligibility and live tracking were retained. The transition does not change model algorithms, weights or generated training artifacts.

## Main files

| Area | Added/modified files |
| --- | --- |
| Database | `supabase/migrations/202609140001_free_social_platform.sql`, `202609160001_social_profile_defaults.sql`, `202609160002_social_tail_identity_and_cache.sql` |
| Social API/domain | `frontend/app/api/social/route.ts`, `frontend/lib/server/social.ts`, `frontend/lib/social.ts`, `frontend/lib/socialClient.ts` |
| Social pages | `frontend/app/profile/`, `my-picks/`, `my-stats/`, `friends/`, `leaderboard/`; `frontend/components/social/` |
| Model/public navigation | `frontend/app/model/`, `player-picks/`, `components/Navbar.tsx`, `Dashboard.tsx`, `GameCard.tsx`, `GameDetailsView.tsx`, `PlayerPicksSection.tsx` |
| Accounts | `frontend/app/account/`, `auth/callback/route.ts`, `lib/authNavigation.ts`, `lib/server/access.ts` |
| Public data/grading | Prediction/game/player routes, `lib/server/playerPicks.ts`, `playerPickAccess.ts`, `predictionSnapshots.ts`, daily-refresh route |
| Removed active code | `lib/stripe.ts`, `lib/server/entitlements.ts`, `app/pro/actions.ts`, `app/api/webhooks/stripe/route.ts` |
| Tests | `tests/publicAccess.test.mjs`, `socialApi.test.mjs`, `socialDatabase.test.mjs`, `tests/browser/social.spec.mjs`, backend training invariants |
| Open source | README, CONTRIBUTING, SECURITY, MIT LICENSE, issue templates, `.gitignore`, `.env.example`, AGENTS, MAP and this checklist |

Legacy `frontend/dist/` and `.wrangler/`, the tracked local environment file and build cache are removed from the versioned tree. Local files are preserved. See `git diff --name-status origin/main` for the complete branch inventory.

## Audit findings: required actions before public visibility

The follow-up local-history scan inspected **258 reachable commits, 900 blobs and 20,307,741 bytes**, including fetched refs available locally. The earlier manual scan classified credential values without printing them. No credential values are reproduced in this report.

| Finding | Evidence | Action |
| --- | --- | --- |
| Populated `CRON_SECRET` | Historical `frontend/.env.local`; blob `ae9ba5df46d1a16262198bc06e854ab741173e51`; introduced in `bcd15fe5aab5cd492b8bef527aa7263020ab4688` | **Must rotate.** Generate a new random bearer token, replace it in every affected Vercel environment and any caller, redeploy, and verify the old token is rejected. Never paste either token in Git or issues. |
| Misconfigured `SUPABASE_SERVICE_ROLE_KEY` | The exposed value is a publishable key, not a service-role secret | Replace this variable with a fresh proper server-only `sb_secret_…` or supported legacy service-role key. The app now rejects publishable/anon keys in this variable. No actual service-role credential was found in available history. |
| Public Supabase project URL, anon JWT and publishable key | Same environment blob | These are intentionally public client identifiers, not admin secrets. Review project RLS and usage; optionally retire the exposed publishable key after updating clients. Do not rotate the signing key blindly: that can invalidate sessions. If any real admin key was used outside the scanned history, rotate it too. |
| Legacy `prerenderSecret` | `frontend/dist/server/ssr/vinext-server.json`; blob `2be0e9fdf102283ff6bd3e3307728c23b5c4257d` | **Retire/rebuild any legacy preview or Worker using that build.** A rebuilt deployment must use a new generated secret. Do not use the old artifact for deployment. |
| Legacy deployment/project metadata | `frontend/dist/.openai/hosting.json`, `.wrangler` metadata | Review linked projects and remove archived previews if unnecessary. Untracking does not remove historical metadata. |
| Commit identity emails and Discord invites | Earlier scan found two non-noreply identities in commit metadata; invite links remain in layout/settings | Confirm consent to publish identity metadata and that the Discord invite is intended to be public. Do not publish private operational notes or screenshots. |

Stripe secret/webhook/price fields and the Odds API key were empty in the accessible historical environment file. No populated Stripe key, private key, database password, GitHub token or actual Supabase service-role token was identified by these scans. This is **not** a guarantee that secrets never existed elsewhere: hosted settings, dangling Git objects, un-fetched refs, forks, PR caches, Actions logs/artifacts, private files and external services were not exhaustively inspected. Review those before publication. Pattern scanning can miss unknown secret formats.

Dependency audit initially reported 2 high and 1 critical dependency entries. Compatible fixes upgraded Next.js to 16.3.5 and updated vulnerable transitive packages. `npm audit` then reported **0 vulnerabilities**. The Next.js issues are documented in the [Windows server advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) and [image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). Re-run the audit at release time.

## Verification evidence

Local verification on 2026-09-16:

| Check | Result |
| --- | --- |
| Frontend domain/API/PostgreSQL tests | **75 passed, 0 failed**; includes all three social migrations, authorization, snapshots, deadlines, grading, tail identity and leaderboard eligibility |
| Browser UI contract tests | **3 passed** in Edge; guest pick prompt, mobile profile editing, model comparison, friends/tailing, pick edits and leaderboard sample requirement |
| Backend training safeguards | **7 passed**; two existing CSV ResourceWarnings noted below |
| ESLint / TypeScript | Both passed |
| Production build | Passed with Next.js **16.3.5** |
| Dependency audit | **0 vulnerabilities** reported |
| Real public API reads with account/provider keys disabled | MLB **15 games**, NFL **16 games**, MLB **40 player picks**, all HTTP 200 with public prediction fields |
| Missing social configuration / unauthorized cron | HTTP **503** with an explicit unavailable state / HTTP **401**, respectively |
| Browser smoke check | Public pages rendered without page errors; dark desktop/mobile layouts inspected; [dashboard screenshot](screenshots/games.png) |

Browser social writes used isolated mock responses; real SQL behavior and API boundaries were tested separately. Hosted two-user auth and production configuration remain unverified. During the final browser test expansion, one run reported **1 failed, 2 passed**: an exact username-label selector did not include the field's help text. The corrected accessible-name selector passed the repeat run. The branch was synchronized with fetched main `19e09dc`; no unresolved merge entries remained. Recheck main immediately before merging if other work lands.

## Database and deployment sequence

1. Back up the existing Supabase database. Use a staging project first; do not run test fixtures against production.
2. Apply historical migrations in timestamp order if absent, then `202609140001_free_social_platform.sql`, `202609160001_social_profile_defaults.sql`, and `202609160002_social_tail_identity_and_cache.sql`. Existing installations apply only migrations not already recorded. They are additive except for revoking client access to the retired account/billing paths.
3. Configure Supabase URL/public key and a valid server-only admin secret. Set `NEXT_PUBLIC_APP_URL`, Auth Site URL and allowed `/auth/callback` URLs. Keep confirmation email delivery configured.
4. Verify sign-up/confirmation/sign-in with two staging users, automatic default profiles, edits, friendship transitions, picks/tailing, lock rejection and final grading. Confirm anonymous responses contain no account emails/UUIDs.
5. Replace `CRON_SECRET`. Keep the Vercel root directory **frontend**, framework **Next.js**, supported Node 22+, install **npm ci**, build **npm run build**. Deploy the tested transition after the migration.
6. Confirm public MLB/NFL slates and player boards return 200 while logged out; verify the social pages use the migrated database. Trigger a refresh with the new token through a secure local caller and inspect its result counts. Confirm an unauthorized call returns 401. The daily job is 09:05 UTC; pending finals are also synchronized during prediction requests.
7. Keep `DFS_BOARDS=off` unless paid per-event Odds API usage is intended. Other optional providers should remain absent or explicitly configured; prediction-only installs work without keys.

No production migration/deployment was executed during this local implementation. PGlite validates PostgreSQL behavior with simulated auth roles, not the hosted Supabase gateway or real email delivery.

## Stripe resources and environment variables

Removing application code does **not** cancel subscriptions or stop recurring invoices.

1. In Stripe, inventory SportIQ subscriptions in live and test mode, including trials and scheduled renewals. Decide the customer transition/refund policy. Cancel affected recurring subscriptions with the intended effective date and verify no future invoices remain scheduled.
2. Disable SportIQ Payment Links and checkout entry points. Archive the dedicated recurring prices/products after subscriptions are handled. Retain financial records and invoices.
3. Disable the webhook endpoint pointing to `/api/webhooks/stripe` and any old deployment receiving it. Disable the SportIQ customer-portal configuration if exclusive to this app.
4. Revoke dedicated SportIQ Stripe restricted/secret keys once no other system uses them. Do not revoke shared keys without checking other consumers.
5. Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` from Vercel production/preview/development and local environments. Remove any obsolete CI variables referring to them. No publishable Stripe key is required by the new app.
6. Keep historical billing columns/promo-code rows for retention needs. The migration revokes invite redemption; no schema deletion is necessary to end paid access.

## Safely make this repository public

1. Keep visibility private until credential/deployment actions above are completed. Update the running site with rotated secrets before revoking keys still used by clients.
2. Fetch latest main and integrate the transition through the normal branch/PR process. Re-run checks after any new upstream changes; conflict-free status is only valid against the last fetched main.
3. Confirm no populated env files, local agent state, generated deployments, tokens or private datasets remain in the release tree. Review all branches and tags, not just main. Enable available secret scanning/push protection and private vulnerability reporting.
4. Clean the exposed history in a **separate fresh clone**, after backing up and coordinating with collaborators. Use `git-filter-repo` to remove historical `frontend/.env.local`, `frontend/dist/`, and `frontend/.wrangler/` from all affected refs. Review affected author metadata if consent is missing. History rewriting is disruptive and was deliberately not performed here.
5. Push rewritten refs only after that coordination; contributors must re-clone/rebase appropriately. Request GitHub support cleanup for sensitive cached PR views where needed and remove affected Actions artifacts. Rotation remains mandatory even after rewriting.
6. Scan a fresh clone of the intended public refs again. Check README screenshots, model/data provenance, MIT license, issue templates and security guidance. Confirm data/image redistribution terms independently from the MIT software license.
7. Only after the audit actions and staging/live checks are complete, change GitHub repository visibility to public in repository settings. Verify the public clone and site as a logged-out visitor.

## Known limits / follow-up work

- Daily cron cadence can leave results pending until the next refresh; missing/removed feed events remain pending rather than inventing an outcome. The refresh response reports failures for retry.
- Social writes are protected by auth, SQL grants and deadlines; abuse controls such as friendship request limits, blocks, report/moderation flows and application-level rate limiting are future hardening for a large public community.
- Social lists are currently bounded (100 recent picks, 50 feed items, 100 leaderboard entries); pagination and larger-scale incremental aggregation are future work. Stats recalculate on mutations/grading, not each profile read.
- Avatar uploads and generalized social posts/messages are intentionally absent. Individual picks keep historical tail attribution; aggregate tail records resolve the current username and remove profile links for deleted accounts.
- Backend tests currently emit two ResourceWarnings about an existing trainer CSV stream not being closed. These do not fail tests or affect model coefficients.
- The retired historical invite extension is not exercised in the isolated SQL harness. Real Supabase auth/email, production RLS deployment configuration, Stripe state and credential rotation still require the operator checks above.
