# Sprint 1 — Deliverable A: Architecture Map

Pinned issue: [#2](https://github.com/alphatrann/outline/issues/2) — B Architecture and test design.
Baseline: pinned SHA `05ef55e38` present in history; working HEAD `0893a08` (merge PR #6 sprint-1/env-setup, +3 commits ahead). All paths below verified at HEAD.

Out of scope for Sprint 1: OAuth/OIDC/email login, attachments/MinIO, realtime collaboration (Y.js), UI.

## 1. Monorepo layout

| Directory | Responsibility | Key entries |
|---|---|---|
| `app/` | React + Vite frontend (out of scope except as API caller) | `routes/`, `scenes/`, `models/`, `stores/` (MobX), `components/` |
| `server/routes/api/` | Koa RPC-style routes, all `POST /api/*` + Zod `schema.ts` + colocated `*.test.ts` | `documents/`, `collections/`, `revisions/`, `searches/`, `shares/`, `users/`, `teams/` |
| `server/models/` | Sequelize + Postgres models, scopes, hooks | `Document.ts`, `Collection.ts`, `Revision.ts`, `Share.ts`, `SearchQuery.ts`, `UserMembership.ts`, `GroupMembership.ts`, `Team.ts`, `User.ts` |
| `server/commands/` | Multi-model business logic, one file per action + `*.test.ts` | `documentCreator/Updater/Mover/Loader/Restorer/Duplicator.ts`, `shareLoader.ts`, `teamProvisioner.ts` |
| `server/policies/` | cancan authorization, one file per model | `document.ts`, `collection.ts`, `revision.ts`, `share.ts`, `searchQuery.ts`, `team.ts` |
| `server/presenters/` | Backend → frontend JSON boundary | `document.ts`, `collection.ts`, `revision.ts`, `share.ts` |
| `server/queues/` | Bull + Redis async events | `processors/RevisionsProcessor.ts`, `DebounceProcessor.ts`, `SearchIndexProcessor.ts`, `tasks/DocumentUpdateTextTask.ts` |
| `server/middlewares/` | Koa auth, pagination, error handling | `authentication.ts`, `apiErrorHandler.ts` |
| `plugins/search-postgres/server/` | Default search backend | `PostgresSearchProvider.ts` (Postgres FTS) |
| `shared/` | Shared types + editor (Prosemirror) | `types.ts` (`CollectionPermission`, `UserRole`) |

Backend contract: `docs/ARCHITECTURE.md`. API routes thin; logic lives in `commands/` + model methods.

## 2. Module map per in-scope flow

### Flow 1 — User/Team + collection permissions

| Layer | Files | Role |
|---|---|---|
| Routes | `server/routes/api/collections/collections.ts`, `teams/teams.ts`, `users/users.ts` | `collections.create/info/list/update/add_user/remove_user/add_group/remove_group/archive/restore/delete` |
| Models | `server/models/Collection.ts` (`permission: read \| read_write \| null`, `sharing`), `UserMembership.ts` (`user_permissions`), `GroupMembership.ts` (`group_permissions`), `Group.ts`, `Team.ts` (`memberCollectionCreate`, `sharing`), `User.ts` (`role: admin \| member \| viewer \| guest`) | Private = `permission=null`; shared = `read/read_write` open to team; guests always need explicit membership row |
| Policies | `server/policies/collection.ts`, `team.ts` | `createCollection`: non-guest/viewer + `memberCollectionCreate`; `read`: private/guest → `includesMembership()` (preloaded `withMembership` scope); `update/archive/delete`: teamAdmin or `admin` membership |
| Caches | `User.collectionIds()` (10s `getUserCollectionIdsKey`), `membershipUserIds()` | Union of direct + group memberships |

### Flow 2 — Document lifecycle

| Layer | Files | Role |
|---|---|---|
| Routes | `server/routes/api/documents/documents.ts` | `create/update/move/duplicate/import/export/info/list/archived/deleted/archive/delete/restore/unpublish/templatize/empty_trash/add_user/add_group` |
| Commands | `server/commands/documentCreator.ts` (+ `authorizeDocumentCreate/Publish`), `documentUpdater.ts` (row-lock + `DocumentConflictError`), `documentMover.ts` (collection `documentStructure` index fix), `documentLoader.ts` (authz read/restore), `documentRestorer.ts`, `documentPermanentDeleter.ts` | Build/save/publish/move/restore/delete; title `previousTitles`, `collaboratorIds`, `revisionCount++` in hooks |
| Model | `server/models/Document.ts` (`paranoid`, `defaultScope: publishedAt!=null`) | Fields `urlId/title/content(JSONB)/state(BLOB Yjs)/collectionId/parentDocumentId/publishedAt/archivedAt`; `publish/unpublishWithCtx/archiveWithCtx/restoreTo/destroyWithCtx`; CTE child/parent guards |
| Policy | `server/policies/document.ts` | `createDocument@Team`, `read/update/publish/move/archive/...` gated on draft/active + membership RW/Admin or `collection.updateDocument` |
| Presenter | `server/presenters/document.ts` | `presentDocument(isPublic, shareId)` strips private fields for public shares |
| Events | `Model.saveWithCtx → documents.create/update/delete/publish/archive/move/...`, `RevisionsProcessor`, `SearchIndexProcessor` | Async revision + search indexing |

### Flow 3 — Revisions

| Layer | Files | Role |
|---|---|---|
| Routes | `server/routes/api/revisions/revisions.ts` | `info` (by `id` or transient `buildFromDocument`), `list` (excl. `content/text`), `update` (rename only), `delete` (Admin), `export` (html/md/textbundle) |
| Model | `server/models/Revision.ts` (`paranoid`, includes `user`) | `title/content/icon/editorVersion/collaboratorIds`, `createFromDocument(ctx, doc)`, `findLatest(docId)` |
| Creation | `server/queues/processors/DebounceProcessor.ts` (`update → delayed 5m → debounced`), `RevisionsProcessor.ts` (`publish/update(done)/debounced` → skip if deep-equal latest → `Revision.createFromDocument` in tx) | Async, not inline in `documentUpdater` |
| Policy | `server/policies/revision.ts` (`update`: owner/admin; `delete`: admin), `document.ts` (`listRevisions`: `read`, guests need `update`) | Restore path is `documents.restore { revisionId } → documentRestorer` |

### Flow 4 — Search + share link

| Layer | Files | Role |
|---|---|---|
| Routes | `server/routes/api/documents/documents.ts` (`search`, `search_titles`), `server/routes/api/searches/searches.ts` (`list/update/delete`), `server/routes/api/shares/shares.ts` (`info/list/create/update/revoke/sitemap/subscribe`) | Public search via `shareId`; own-query history in `searches.*` |
| Models | `server/models/SearchQuery.ts` (`query/results/duration/score/source`), `server/models/Share.ts` (UUID PK, `urlId` slug, `published/revokedAt/domain/includeChildDocuments`) | `SearchQuery.record()` collapses as-you-type (30s window); `Share.canonicalUrl` |
| Search backend | `plugins/search-postgres/server/PostgresSearchProvider.ts`, `server/utils/SearchProviderManager.ts`, migrations `documents_search_trigger()` | Postgres `tsvector`: `title(A) + previousTitles(C) + substring(text,1,500K)(D)`; `searchVector @@ to_tsquery`, `ts_rank * popularity boost`; `SearchIndexProcessor` no-op for postgres |
| Policy/loader | `server/policies/share.ts`, `searchQuery.ts` (owner-only), `server/commands/shareLoader.ts` (`loadPublicShare`, `loadShareWithParent`) | Token = `Share.id`; slug needs `teamId`; checks `published`, `revokedAt null`, `team.sharing && collection.sharing`, archived guards |
