# Sprint 1 — Deliverable B: Data Flows (sketches)

The Mermaid blocks below are the single source of truth for the diagrams (they render in PR review; no standalone copies are kept). Container + component views are C4-style sketches, not strict C4.

```mermaid
flowchart TB
  Client["Web client (out of scope, API caller)"]
  API["Koa API<br/>routes/api<br/>+ server/middlewares + routes/api/middlewares"]
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

### Component view (API internals)

```mermaid
flowchart TB
  subgraph Client["Web client (C4: external actor, out of scope)"]
    UI["React/MobX scenes"]
  end
  subgraph API["C4 container: Koa API service"]
    MW["Middlewares<br/>server/middlewares (authentication)<br/>routes/api/middlewares (pagination, apiErrorHandler)"]
    Router["Routers<br/>documents / collections<br/>revisions / searches / shares"]
    Pol["Policies (cancan)<br/>document / collection<br/>revision / share / team"]
    Cmd["Commands<br/>documentCreator / Updater<br/>Mover / Loader / shareLoader"]
    Pres["Presenters<br/>document / collection<br/>revision / share"]
    Proc["Queue processors<br/>Debounce / Revisions<br/>SearchIndex + tasks"]
  end
  subgraph Data["C4 containers: data + workers"]
    PG[("PostgreSQL<br/>documents + searchVector tsvector<br/>collections, revisions, shares,<br/>user/group memberships")]
    Redis[("Redis + Bull<br/>events, debounce,<br/>task queues")]
    Search["Search provider<br/>Postgres FTS plugin<br/>ts_rank x popularity"]
  end
  UI -->|"POST /api/*"| MW
  MW --> Router
  Router --> Pol
  Pol -->|"allow"| Cmd
  Cmd --> PG
  Cmd -->|"insertEvent"| Redis
  Redis --> Proc
  Proc -->|"createFromDocument"| PG
  Proc --> Search
  Search --> PG
  Cmd --> Pres
  Pres --> Router
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

Key rule: shared (`read/read_write`) open to team; private (`permission=null`) and guests require explicit row. See `ARCHITECTURE.md` Flow 1.

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
