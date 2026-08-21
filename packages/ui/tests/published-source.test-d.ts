import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
  type PublishedSourceRevision,
} from "../src/lib/published-source";

const file = new File(["{}\n"], "source.jsonl");
const access = createLocalFileAccess(file);
const memory = createTextSourceRevision(1, "{}", "json");
const localFile = createStreamingFileSourceRevision(2, access, "jsonl");

// @ts-expect-error Streaming is a JSONL capability and cannot publish a JSON mode.
createStreamingFileSourceRevision(3, access, "json");

// @ts-expect-error A published revision must contain one complete source variant.
const _splitRevision: PublishedSourceRevision = { sourceRevision: 4 };

if (memory.kind === "memory") {
  // @ts-expect-error An in-memory Source cannot also carry Local-file Source Access.
  const _contradictoryMemory: PublishedSourceRevision = { ...memory, access };
}

if (localFile.kind === "local-file") {
  const _contradictoryLocalFile: PublishedSourceRevision = {
    ...localFile,
    // @ts-expect-error A Local-file Source cannot also carry in-memory text.
    text: "{}",
  };
}
