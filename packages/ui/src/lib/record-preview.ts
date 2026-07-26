import type { JsonlRecordPreview } from "@unquote/core";
import { formatJsonPath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

export const getPreviewPathSegments = (key: string): TreePathSegment[] => [
  { kind: "key", value: key },
];

export const getPreviewPath = (key: string) => formatJsonPath(getPreviewPathSegments(key));

export const getPreviewMaxDepth = (preview: JsonlRecordPreview) =>
  Object.keys(preview.fields).length > 0 || Object.keys(preview.containers ?? {}).length > 0
    ? 1
    : 0;
