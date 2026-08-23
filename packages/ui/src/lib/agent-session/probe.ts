import { drainJsonlLines } from "../jsonl-lines";

const probeLineLimit = 80;
const codexEnvelopePattern =
  /"type"\s*:\s*"(?:session_meta|event_msg|response_item|turn_context|compacted)"/;
const claudeTranscriptTypePattern = /"type"\s*:\s*"(?:user|assistant)"/;
const uuidPattern = /"uuid"\s*:/;
const messagePattern = /"message"\s*:/;

const mightBeAgentLine = (line: string) =>
  codexEnvelopePattern.test(line) ||
  (claudeTranscriptTypePattern.test(line) && uuidPattern.test(line) && messagePattern.test(line));

export const mightContainAgentSession = (input: string) => {
  let scannedLines = 0;
  let matched = false;

  drainJsonlLines("", input, true, (line) => {
    if (!line.trim()) {
      return;
    }

    scannedLines += 1;
    matched = mightBeAgentLine(line);
    if (matched || scannedLines >= probeLineLimit) {
      return false;
    }
  });

  return matched;
};
