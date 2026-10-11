# Sprint 1 — Deliverable D (draft): K16 Principles + Limitations

K16 = Ephemeral Integration Testing / Testcontainers. Status: **draft for review**, no code changes yet. The repo now has a Testcontainers harness on `main` (PR #7): `server/test/containers.ts` (`startContainers()` — Postgres 17 + Redis 8, migrations applied), `server/test/globalSetupContainers.ts` (global setup), `server/test/setupIntegration.ts` (no ioredis/bull mocks), `server/test/cleanup.ts` (`cleanBetweenTests()`), Vitest `server-integration` project (`server/**/*.integration.test.{ts,tsx}`, serial, 30s timeout), example `server/routes/api/users/users.integration.test.ts` (TestServer + factories + cleanup). Unit tests keep running on shared dev/test Postgres via `server/test/setup.ts` + `factories.ts` + `TestServer.ts` (`server-shared` project, `isolate: false` — files using `vi.mock`/`vi.resetModules` must start with `// @vitest-isolate true`).

## 1. Principles (proposed)

1. **Hermetic Postgres (+ Redis) per run.** The `server-integration` project boots its own containers via `startContainers()` (`postgres:17`, `redis:8` — versions pinned in `containers.ts`, matching `docker-compose.yml`), applies all migrations from `server/migrations/`, seeds via `factories.ts` (`buildTeam/buildUser/buildCollection/buildDocument`). Containers start once per run (`globalSetupContainers.ts`) and are shared serially (`fileParallelism: false`) with `cleanBetweenTests()` wiping rows between tests — no shared DB state between runs.
2. **Migration-seeded, trigger-faithful.** Use real migrations so `documents_search_trigger()` (tsvector `title(A)/previousTitles(C)/text(D)`) exists — required for Flow 4 search ranking tests.
3. **API-boundary tests.** Drive `POST /api/*` through `TestServer` (supertest-style) with API-token auth, assert via presenters + status codes — not internal function calls.
4. **Deterministic async.** Revision creation is debounced (`DebounceProcessor` 5m prod / 0.5m dev → `RevisionsProcessor` skips deep-equal latest). Tests await/poll `Revision.findLatest()` instead of sleeping fixed time; Bull queue uses ephemeral Redis.
5. **Serial + fast teardown.** One container pair per run, files serial (`fileParallelism: false`), `cleanBetweenTests()` between tests, containers stopped on global teardown; no S3/MinIO/network (S3 mocked in `setup.ts`, `setupIntegration.ts` additionally avoids ioredis/bull mocks, MSW `server.listen({ onUnhandledRequest: "error" })` stays). Docker-host autodetect (`configureDockerHost()`) covers Colima/Rancher/rootless; needs Docker + 120s hook timeout budget.
6. **Scope-locked.** Only the 4 fixed flows in `scope-assumptions.md`; everything else mocked or excluded.

## 2. Limitations (explicit non-goals)

- **No MinIO/S3 content:** attachments/import/export file bodies stay mocked (`@aws-sdk/*` mocks); only metadata rows tested.
- **No realtime Y.js:** `Document.state` BLOB / collaboration server notifications (`APIUpdateExtension.notifyUpdate`) not asserted beyond `collaboratorIds`.
- **No OAuth/OIDC/email:** login, `groupsSyncer` SSO, mail delivery excluded; auth = pre-seeded user + token.
- **PG-only parity:** FTS ranking (`to_tsquery`, `ts_rank * popularity`) is Postgres-specific; external providers (Elastic) not covered.
- **Cost:** container boot + migrations add seconds per run (120s hook budget, 30s test timeout); suite is serial by design, so keep it to the 4 fixed flows and document `yarn test` time before/after.

## 3. Mapping: what goes where

| Flow | Testcontainers integration (new) | Plain Vitest unit (existing pattern) |
|---|---|---|
| 1 permissions | `collections.*` allow/deny matrix incl. private-vs-shared + guest | `policies/collection.test.ts` pure ability checks |
| 2 document lifecycle | `create → update → move → archive → restore → delete` round-trip via API | `commands/document*.test.ts`, `models/Document.test.ts` hooks |
| 3 revisions | debounced creation + `revisions.list/info` + `restore { revisionId }` | `models/Revision.test.ts` builders |
| 4 search + share | FTS ranking + `search { shareId }` scoping + `shares.revoke` invalidation | `PostgresSearchProvider.test.ts`, `commands/shareLoader.test.ts` |

Conventions to keep: colocated `*.test.ts`, `server/test/support.ts` helpers, `// @vitest-isolate true` header when mocking modules, no manual i18n strings, `yarn format` clean.

## 4. Next step (Sprint 2)

Harness exists (PR #7) — add `*.integration.test.ts` per fixed flow following the `users.integration.test.ts` pattern (TestServer + factories + `cleanBetweenTests()`), starting with one proof flow (Flow 2 create/update round-trip) before expanding to all four. Keep `resolutions` scoping per AGENTS.md if a transitive advisory appears.
