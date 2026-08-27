import type { SourceRevision } from "./source-revision";
import type { ResolvedTreePath } from "./tree-path";

export type QueryNavigationTarget =
  | { sourceRevision: SourceRevision; kind: "clear" }
  | {
      sourceRevision: SourceRevision;
      kind: "path";
      target: Pick<ResolvedTreePath, "recordId" | "pathText" | "rawKey" | "stringifiedPathChain">;
    }
  | {
      sourceRevision: SourceRevision;
      kind: "search";
      recordId: string;
      pathText: string;
    };

export interface QueryNavigationRequest {
  requestId: number;
  target: QueryNavigationTarget;
}
