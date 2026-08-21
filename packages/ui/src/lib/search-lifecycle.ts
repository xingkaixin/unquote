export type SearchStatus = "idle" | "pending" | "complete" | "error";

export type SearchErrorKind = "timeout" | "worker-error" | "too-large" | "regex-without-worker";
