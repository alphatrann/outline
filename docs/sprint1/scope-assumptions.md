# Sprint 1 — Fixed Scope + Assumptions (4 flows)

Issue [#2](https://github.com/alphatrann/outline/issues/2), step 3. Auth for all flows below: API token / authenticated user (not OAuth/OIDC/email login).

## Flow 1 — User/Team + collection permissions

In scope: `collections.create/info/list/update`, `add_user/remove_user/memberships`, `add_group/remove_group/group_memberships`, `archive/restore` (permission-gated).
Preconditions: seeded team + admin + member + viewer + guest; one shared collection (`read_write`), one private (`permission=null`).
Expect: `create` 200 for admin/member (if `memberCollectionCreate`), 403 for viewer/guest; `list` returns only `collectionIds()`; private `info` 403 without membership row, 200 with it.
Non-goals: SSO/OIDC group sync (`groupsSyncer`), email invites, UI.

## Flow 2 — Document lifecycle

In scope: `documents.create/update/move/info/list/archive/restore/delete/unpublish/duplicate`, `add_user/remove_user`.
Preconditions: Flow 1 seeds + collection with `read_write` membership for editor.
Expect: `create` 200 + `urlId`; concurrent `update` → `DocumentConflictError` path; `move` fixes `documentStructure` index; `archive` then `restore { collectionId }` round-trips; `delete` soft, `delete { permanent: true }` hard (Admin).
Non-goals: import/export files, templates, comments/reactions, realtime Y.js, attachments.

## Flow 3 — Revisions

In scope: `revisions.list/info/update/delete/export`, `documents.restore { revisionId }`.
Preconditions: published doc + ≥1 `update` (debounce may delay async creation — tests must await processor or poll `findLatest`).
Expect: `list` excludes `content/text`; `update` renames only and needs doc-`update` + revision-`update`; `delete` needs Admin; `export` html/md; `restore` creates new state (does not delete revision).
Non-goals: realtime collaborative editing attribution beyond `collaboratorIds`.

## Flow 4 — Search + share link

In scope: `documents.search/search_titles`, `searches.list/update/delete`, `shares.create/info/list/update/revoke`.
Preconditions: docs with distinct titles (weights A/C/D), one published share (`published=true`, `includeChildDocuments` variant).
Expect: `search` ranks title matches first (`ts_rank * popularity`); `search { shareId }` scoped to share tree, rejects child search if `!includeChildDocuments`; `shares.info` public without auth, 403/404 if `revokedAt` set or `team/collection.sharing=false`; `searches.*` owner-only.
Non-goals: external search providers (Elastic), MinIO attachment content search, share email subscriptions, sitemap SEO.

## Global assumptions

- Postgres + Redis available (local dev per `docker-compose.yml` / onboarding); tests seed via migrations, not fixtures hand-edited.
- `SEARCH_PROVIDER=postgres` (default); tsvector trigger present.
- Clock-sensitive revision debounce (5m prod / 0.5m dev) must be shortened or awaited in tests.
- No i18n strings added; no code changes in this deliverable (docs-only).
