# Source Revision lifecycle

A Source Revision is an immutable, monotonically increasing version of the current Source and its
parse mode. Production revisions are published by `useSourceLoader`; returning to earlier content
publishes another revision instead of reactivating an old one.

## Shared commit rules

1. A render for a new revision projects fresh state immediately, even if React still stores the
   preceding revision internally.
2. Every state update and asynchronous result carries the revision that produced it.
3. An older revision never replaces state already owned by a newer revision.
4. Request ordering within one revision remains a feature concern. Parser and search use request
   ids because multiple requests can legitimately belong to the same revision.
5. Sample expansion is the only planned future-revision write. Source publication returns its new
   revision so the workspace can seed expansion state before the corresponding render.

## Retention matrix

| Projection | New revision | Same-revision updates |
|---|---|---|
| Parser | Pending snapshot; no Records or Agent Session retained | Streaming batches and the terminal result replace only the active request |
| Search | Idle without a query, otherwise pending; no matches retained | Window requests may reuse the worker's parsed Source cache |
| Query | Query text, options, navigation and Record filter reset | User intent and materialized search windows are retained |
| Workspace | Record, node, Agent detail, scroll intent and expansions reset | Selection and expansion changes are retained; sample expansion may be pre-seeded |
| Output | JSON until an Agent Session is recognized, then Agent defaults once | A manual Agent, Trajectory or JSON choice survives streaming session updates |
| Local-file cache | Full Record cache and in-flight hydration ownership reset | Hydrated Records are retained within the bounded cache |

Feature modules own the behavior in the final column. `source-revision.ts` owns only revision
projection, obsolete-update rejection and atomic result commit rules.
