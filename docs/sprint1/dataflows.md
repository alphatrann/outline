# Sprint 1 — Deliverable B: Data Flows (sketches)

Source file for container diagram: `diagrams/container.mmd` (Mermaid `flowchart TB`, renders on GitHub).

```mermaid
flowchart TB
  Client["Web client (out of scope, API caller)"]
  API["Koa API<br/>routes/api + middlewares<br/>auth, pagination, apiErrorHandler"]
  Cmd["Commands<br/>documentCreator/Updater/Mover<br/>shareLoader, teamProvisioner"]
  Pol["Policies (cancan)<br/>document/collection/revision/share"]
  Pres["Presenters<br/>document/collection/revision/share"]
  PG[("Postgres<br/>documents incl. searchVector<br/>collections, revisions, shares")]
  Redis[("Redis + Bull<br/>events, debounce,<br/>revisions, search index")]
  Search["Search provider<br/>Postgres FTS (default)<br/>plugins/search-postgres"]
  Client -->|"POST /api/*"| API
  API --> Pol
  Pol -->|"allow"| Cmd
  Cmd --> PG
  Cmd -->|"insertEvent"| Redis
  Redis -->|"debounced update"| Search
  Cmd --> Pres
  Pres --> API
  API -->|"JSON"| Client
  Search --> PG
```

## Flows in scope (4)

### 1. User/Team + collection permissions

```mermaid
sequenceDiagram
  participant C as Client
  participant R as collections.* route
  participant P as policies/collection
  participant M as UserMembership/GroupMembership
  C->>R: POST collections.create / add_user
  R->>P: authorize(createCollection / update, team)
  P->>M: check membership (withMembership scope)
  M-->>R: allow (teamAdmin or admin-membership or shared permission)
  R->>M: write user_permissions / group_permissions
```

Key rule: shared (`read/read_write`) open to team; private (`permission=null`) and guests require explicit row. See `architecture.md` Flow 1.

### 2. Document lifecycle

```mermaid
sequenceDiagram
  participant C as Client
  participant R as documents.* route
  participant P as policies/document
  participant K as commands/document*
  participant D as Postgres Document
  C->>R: POST documents.create / update / move / archive
  R->>P: authorize(createDocument / update / move / archive)
  P-->>R: allow
  R->>K: documentCreator / Updater / Mover
  K->>D: saveWithCtx + collectionStructure update
  D-->>K: insertEvent (create/update/move/archive)
  K-->>C: presentDocument
```

Row-lock + `DocumentConflictError` on concurrent update; move fixes `documentStructure` index.

### 3. Revisions (async)

```mermaid
sequenceDiagram
  participant K as documentUpdater
  participant Q as Bull/Redis (Debounce)
  participant V as RevisionsProcessor
  participant R as revisions table
  K->>Q: documents.update event
  Q->>Q: delayed 5m → debounced (skip if updatedAt > event.createdAt)
  Q->>V: documents.update.debounced / publish
  V->>R: skip if deep-equal latest, else createFromDocument (tx)
```

Read path: `revisions.list/info` + `documents.restore { revisionId }`. Rename-only `revisions.update`; `delete` Admin-only.

### 4. Search + share link

```mermaid
sequenceDiagram
  participant C as Client
  participant S as shares / documents.search
  participant L as shareLoader
  participant F as Postgres FTS
  C->>S: POST shares.create → share.id token
  S->>L: loadPublicShare (published, revokedAt null, team/collection sharing)
  C->>S: POST documents.search { shareId } / searches.list
  S->>F: searchVector @@ to_tsquery + ts_rank
  F-->>C: ranked docs + SearchQuery.record
```

Token = `Share.id` (UUID); pretty `urlId` slug needs `teamId`. `SearchIndexProcessor` is no-op for default postgres provider.

## 5th (optional, deferred)

Background indexing / event-bus fan-out (`DocumentPublishedNotificationsTask`, external search providers). Sketched only as `Redis → Search` edge above; full sequence deferred to Sprint 2 if needed.
