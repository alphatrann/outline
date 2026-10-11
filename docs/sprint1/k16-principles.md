# Sprint 1 — Deliverable D (draft): K16 Principles + Limitations

K16 = Ephemeral Integration Testing / Testcontainers. Status: **draft for review**, no code changes yet. Repo today has **no** `testcontainers` dependency (verified by grep); server tests run on a shared dev/test Postgres via `server/test/setup.ts` + `factories.ts` + `TestServer.ts` under Vitest (`server-shared` project, `isolate: false`, shared module registry — files using `vi.mock`/`vi.resetModules` must start with `// @vitest-isolate true`).

## 1. Principles (proposed)

1. **Hermetic Postgres (+ Redis) per run.** Each integration suite boots its own containers (`postgres:16`, `redis:7`), runs migrations from `server/migrations/`, seeds via `factories.ts` (`buildTeam/buildUser/buildCollection/buildDocument`). No shared DB state between runs.
2. **Migration-seeded, trigger-faithful.** Use real migrations so `documents_search_trigger()` (tsvector `title(A)/previousTitles(C)/text(D)`) exists — required for Flow 4 search ranking tests.
3. **API-boundary tests.** Drive `POST /api/*` through `TestServer` (supertest-style) with API-token auth, assert via presenters + status codes — not internal function calls.
4. **Deterministic async.** Revision creation is debounced (`DebounceProcessor` 5m prod / 0.5m dev → `RevisionsProcessor` skips deep-equal latest). Tests await/poll `Revision.findLatest()` instead of sleeping fixed time; Bull queue uses ephemeral Redis.
5. **Parallel-safe + fast teardown.** Random DB names per worker, `afterAll` container stop + volume remove; no S3/MinIO/network (S3 already mocked in `setup.ts`, MSW `server.listen({ onUnhandledRequest: "error" })` stays).
6. **Scope-locked.** Only the 4 fixed flows in `scope-assumptions.md`; everything else mocked or excluded.

## 2. Limitations (explicit non-goals)

- **No MinIO/S3 content:** attachments/import/export file bodies stay mocked (`@aws-sdk/*` mocks); only metadata rows tested.
- **No realtime Y.js:** `Document.state` BLOB / collaboration server notifications (`APIUpdateExtension.notifyUpdate`) not asserted beyond `collaboratorIds`.
- **No OAuth/OIDC/email:** login, `groupsSyncer` SSO, mail delivery excluded; auth = pre-seeded user + token.
- **PG-only parity:** FTS ranking (`to_tsquery`, `ts_rank * popularity`) is Postgres-specific; external providers (Elastic) not covered.
- **Cost:** container boot + migrations add seconds per worker; keep suite to the 4 flows, reuse one container per file (not per test), document `yarn test:server` time before/after.

## 3. Mapping: what goes where

| Flow | Testcontainers integration (new) | Plain Vitest unit (existing pattern) |
|---|---|---|
| 1 permissions | `collections.*` allow/deny matrix incl. private-vs-shared + guest | `policies/collection.test.ts` pure ability checks |
| 2 document lifecycle | `create → update → move → archive → restore → delete` round-trip via API | `commands/document*.test.ts`, `models/Document.test.ts` hooks |
| 3 revisions | debounced creation + `revisions.list/info` + `restore { revisionId }` | `models/Revision.test.ts` builders |
| 4 search + share | FTS ranking + `search { shareId }` scoping + `shares.revoke` invalidation | `PostgresSearchProvider.test.ts`, `commands/shareLoader.test.ts` |

Conventions to keep: colocated `*.test.ts`, `server/test/support.ts` helpers, `// @vitest-isolate true` header when mocking modules, no manual i18n strings, `yarn format` clean.

## 4. Next step (Sprint 2)

Add `testcontainers` dev dep (scoped `resolutions` per AGENTS.md if transitive advisory), new `server/test/containers.ts` helper, one proof flow (Flow 2 create/update round-trip) before expanding to all four.
