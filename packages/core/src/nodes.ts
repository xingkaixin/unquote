import type { JsonNode, JsonNodeWithChildren, TruncatedJsonNode } from "./types.js";

export const hasJsonNodeChildren = (node: JsonNode): node is JsonNodeWithChildren =>
  node.children !== undefined;

export const isStringifiedNode = (node: JsonNode) =>
  node.rawString !== undefined || (node.kind === "string" && node.stringifiedPreview === true);

export const isTruncatedJsonNode = (node: JsonNode): node is TruncatedJsonNode =>
  node.truncated === true;
