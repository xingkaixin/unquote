import { parseInput } from "@unquote/core";

self.onmessage = (event: MessageEvent<{ input: string; forcedFormat?: "json" | "jsonl" }>) => {
  const { input, forcedFormat } = event.data;
  const result = parseInput(input, forcedFormat ? { forcedFormat } : {});
  self.postMessage(result);
};

export {};
