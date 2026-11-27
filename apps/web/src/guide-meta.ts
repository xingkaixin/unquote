import type { SourceMode } from "@unquote/ui";
import type { GuideLocale, GuideSlug } from "./site-links";

export interface GuideRuntimeMeta {
  defaultMode: SourceMode;
  sampleId: string;
  trySampleLabel: Readonly<Record<GuideLocale, string>>;
}

export const guideRuntimeMeta: Readonly<Record<GuideSlug, GuideRuntimeMeta>> = {
  "jsonl-viewer": {
    defaultMode: "jsonl",
    sampleId: "mixed-valid-invalid-jsonl",
    trySampleLabel: {
      en: "Load mixed valid/invalid JSONL sample",
      "zh-CN": "载入有效/无效混合 JSONL 示例",
    },
  },
  "json-unescape": {
    defaultMode: "auto",
    sampleId: "escaped-api-response",
    trySampleLabel: {
      en: "Load escaped JSON API sample",
      "zh-CN": "载入转义 JSON API 示例",
    },
  },
  "agent-log-viewer": {
    defaultMode: "jsonl",
    sampleId: "codex-rollout-jsonl",
    trySampleLabel: {
      en: "Load Codex rollout session sample",
      "zh-CN": "载入 Codex rollout 会话示例",
    },
  },
  "sse-viewer": {
    defaultMode: "sse",
    sampleId: "sse-stream",
    trySampleLabel: {
      en: "Load LLM SSE stream sample",
      "zh-CN": "载入大模型 SSE 流式示例",
    },
  },
};
