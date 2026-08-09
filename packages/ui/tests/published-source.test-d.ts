import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
  projectSourceWork,
  type PublishedSourceRevision,
  type SourceWorkProjection,
} from "../src/lib/published-source";

const file = new File(["{}\n"], "source.jsonl");
const access = createLocalFileAccess(file);
const memory = projectSourceWork(createTextSourceRevision(1, "{}", "json"));
const localFile = projectSourceWork(createStreamingFileSourceRevision(2, access, "jsonl"));

// @ts-expect-error Streaming is a JSONL capability and cannot publish a JSON mode.
createStreamingFileSourceRevision(3, access, "json");

// @ts-expect-error Published revisions can only be created by an atomic source constructor.
const _splitRevision: PublishedSourceRevision = { sourceRevision: 4 };

if (memory.kind === "memory") {
  // @ts-expect-error An in-memory Source cannot also carry Local-file Source Access.
  const _contradictoryMemory: SourceWorkProjection = { ...memory, access };
}

if (localFile.kind === "local-file") {
  const _contradictoryLocalFile: SourceWorkProjection = {
    ...localFile,
    // @ts-expect-error A Local-file Source cannot also carry in-memory text or a mode override.
    text: "{}",
    forcedFormat: "json",
  };
}
