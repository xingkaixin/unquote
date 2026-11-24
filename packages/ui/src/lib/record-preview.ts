import type { JsonlRecordPreview } from "@unquote/core";
import { formatJsonPath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

const previewCacheLimit = 2048;

const previewPathCache = new Map<string, string>();

const previewSegmentsCache = new Map<string, TreePathSegment[]>();

export const getPreviewPathSegments = (key: string): TreePathSegment[] => {
  const cached = previewSegmentsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const segments: TreePathSegment[] = [{ kind: "key", value: key }];
  if (previewSegmentsCache.size < previewCacheLimit) {
    previewSegmentsCache.set(key, segments);
  }
  return segments;
};

export const getPreviewPath = (key: string) => {
  const cached = previewPathCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const path = formatJsonPath(getPreviewPathSegments(key));
  if (previewPathCache.size < previewCacheLimit) {
    previewPathCache.set(key, path);
  }
  return path;
};

const hasOwnKey = <T>(record: Record<string, T> | undefined) => {
  if (!record) {
    return false;
  }
  for (const key in record) {
    if (Object.hasOwn(record, key)) {
      return true;
    }
  }
  return false;
};

export const getPreviewMaxDepth = (preview: JsonlRecordPreview) =>
  hasOwnKey(preview.fields) || hasOwnKey(preview.containers) ? 1 : 0;
