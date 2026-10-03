import type { ReactNode } from "react";

interface Guide {
  title: string;
  heading: string;
  description: string;
  summary: string;
  content: ReactNode;
}

export const guides = {
  "jsonl-viewer": {
    title: "JSONL Viewer: Open and Search JSON Lines Files | Unquote",
    heading: "Open and search JSONL files locally",
    description:
      "Open JSONL and NDJSON files in your browser. Inspect records, find invalid lines, search nested values, and export expanded JSON without uploading file contents.",
    summary:
      "Unquote is a free JSONL viewer for newline-delimited JSON. Open a local file or paste records to browse each line as a tree, search keys and values, and inspect parse errors. File contents are processed in your browser; no account or upload is required.",
    content: (
      <>
        <section>
          <h2>How to open a JSONL file</h2>
          <ol>
            <li>
              Open the viewer, then choose a local file, drop it into the import area, or paste
              text.
            </li>
            <li>
              Keep format detection on Auto, or choose JSONL when you want to parse line by line.
            </li>
            <li>Select a record to inspect its nested objects, arrays, and stringified JSON.</li>
            <li>
              Search for a key, value, or path. Use the original line to investigate an error.
            </li>
          </ol>
          <p>
            A failed line does not make the other records unreadable. You can inspect the parse
            error beside its source line and continue working with the valid records.
          </p>
        </section>
        <section>
          <h2>JSONL, NDJSON, and a JSON array</h2>
          <p>
            JSONL and NDJSON both describe newline-delimited JSON: each nonblank line is a complete
            JSON value. A log commonly uses one object per line. Do not put commas between those
            objects or wrap the whole file in array brackets.
          </p>
          <figure>
            <figcaption>Two JSONL records, each on its own line</figcaption>
            <pre tabIndex={0}>
              <code>
                {
                  '{"level":"info","message":"started"}\n{"level":"error","message":"request failed","status":503}'
                }
              </code>
            </pre>
          </figure>
          <p>
            A JSON array instead uses one outer pair of brackets and commas between its values.
            Unquote reads both formats, but JSONL keeps the relationship between records and source
            lines explicit. A newline inside a string must be escaped as <code>\n</code>.
          </p>
        </section>
        <section>
          <h2>Find a record without losing its source</h2>
          <p>
            Search across keys, values, and paths, then select a match to inspect the surrounding
            structure. If a field contains another JSON document stored as a string, Unquote expands
            that document too. Source records and original lines remain available for comparison.
          </p>
          <p>
            For repeated fields, build a record table and export matching rows as CSV. For debugging
            excerpts, select source lines and redact specified paths before exporting a report.
            Review the result before sharing it.
          </p>
        </section>
        <section>
          <h2>Can I view a large JSONL file?</h2>
          <p>
            Local JSONL files use incremental reading and background parsing. Large values may first
            appear as previews, with full records loaded when needed. Browser memory and operation
            limits still apply; a preview is not a promise that every copy or export will fit in
            memory. Unquote reports limits instead of silently exporting incomplete data.
          </p>
        </section>
        <section>
          <h2>Are my JSONL records uploaded?</h2>
          <p>
            Pasted text and imported file contents are parsed locally. The website uses Umami for
            page visits, performance measurements, and selected button clicks. Those measurements do
            not include your imported records or filenames.
          </p>
        </section>
      </>
    ),
  },
  "json-unescape": {
    title: "JSON Unescape: Expand Stringified JSON Online | Unquote",
    heading: "Turn escaped JSON strings into a readable tree",
    description:
      "Unescape stringified JSON inside API responses and logs. Recursively expand nested objects and arrays, inspect the result, and export JSON locally with Unquote.",
    summary:
      "Unquote parses JSON stored inside JSON strings and expands it into structured data. Paste an API response or log record to inspect nested objects and arrays without manually removing backslashes. Processing happens locally in your browser, and the expanded result can be copied or exported.",
    content: (
      <>
        <section>
          <h2>What is stringified JSON?</h2>
          <p>
            An API or log can store a JSON document as the value of a string field. Quotes inside
            that string are escaped, so a normal formatter still shows the inner document as text.
            In this example, <code>body</code> contains a JSON string rather than an object.
          </p>
          <figure>
            <figcaption>Before: JSON stored inside the body string</figcaption>
            <pre tabIndex={0}>
              <code>{'{"body":"{\\"user\\":{\\"id\\":42},\\"active\\":true}"}'}</code>
            </pre>
          </figure>
          <figure>
            <figcaption>After: the string is parsed into an object</figcaption>
            <pre tabIndex={0}>
              <code>{'{\n  "body": {\n    "user": { "id": 42 },\n    "active": true\n  }\n}'}</code>
            </pre>
          </figure>
        </section>
        <section>
          <h2>How to unescape nested JSON</h2>
          <ol>
            <li>
              Open Unquote and paste the complete JSON response, or import the local log file.
            </li>
            <li>Parse the input and expand the field that contains stringified JSON.</li>
            <li>Inspect the resulting tree, or search for a nested key or value.</li>
            <li>Copy the value you need, or export the expanded JSON or JSONL.</li>
          </ol>
          <p>
            Unquote recursively parses valid JSON strings across consecutive layers. Ordinary text
            remains text. If the outer document is invalid, inspect its parse error first;
            unescaping does not repair arbitrary malformed JSON.
          </p>
        </section>
        <section>
          <h2>Why not remove every backslash?</h2>
          <p>
            Backslashes carry information. Escaped quotes, line breaks, Unicode escapes, and literal
            backslashes have different meanings. Replacing every backslash can corrupt a path or
            change a string. Parsing each JSON layer follows the format instead of guessing which
            characters to delete.
          </p>
          <p>
            JSON unescaping also differs from decoding URL percent escapes or HTML entities. Use it
            when the value is encoded as JSON, not as a general-purpose text decoder.
          </p>
        </section>
        <section>
          <h2>How is this different from JSON formatting?</h2>
          <p>
            A formatter changes whitespace and indentation while preserving string values. Unquote
            also expands valid JSON within those strings. This changes the structure of exported
            data: a field that originally held text can become an object, array, or primitive. Keep
            the original file if you need the exact encoded response.
          </p>
          <p>
            JSON number source text is preserved through parsing, copying, and export, including
            integers larger than JavaScript can represent exactly. You can inspect identifiers
            without rounding them to a nearby number.
          </p>
        </section>
      </>
    ),
  },
  "agent-log-viewer": {
    title: "Codex and Claude Code JSONL Log Viewer | Unquote",
    heading: "Read Codex and Claude Code session logs",
    description:
      "Inspect supported Codex and Claude Code JSONL logs locally. Follow conversations, tool calls, results, and trajectories while keeping links to original records.",
    summary:
      "Unquote turns recognized Codex rollout and Claude Code transcript JSONL files into readable Agent and Trajectory views. Follow messages, tool calls, results, and session activity alongside the original JSON records. Import a local log to investigate a run without uploading its contents.",
    content: (
      <>
        <section>
          <h2>Open a session log</h2>
          <ol>
            <li>Choose or drop a local JSONL session file into Unquote.</li>
            <li>Let Auto detect the format, or select JSONL to parse the file line by line.</li>
            <li>Use Agent for the conversation and Trajectory for activity over time.</li>
            <li>
              Select an event and inspect its linked source record when you need the raw details.
            </li>
          </ol>
          <p>
            You can start with the built-in Codex rollout sample to explore the views without
            finding a file first. Session detection depends on recognized record structures; naming
            a file after an agent does not make an unrelated log compatible.
          </p>
        </section>
        <section>
          <h2>Choose the view that answers your question</h2>
          <dl>
            <dt>Agent: what did the assistant do?</dt>
            <dd>
              Read the conversation and inspect tool calls and their results. The view groups
              supported session events so you can follow the work without reading each JSONL line.
            </dd>
            <dt>Trajectory: when did the work happen?</dt>
            <dd>
              Follow timed activity, narrow the range, and filter by event kind, status, or
              failures. Long idle gaps are compressed in the overview so active periods remain
              readable.
            </dd>
            <dt>JSON: what did the log actually contain?</dt>
            <dd>
              Inspect the original record structure, search nested fields, and check source lines.
              Use this view when a summary needs context or a record format is not recognized.
            </dd>
          </dl>
        </section>
        <section>
          <h2>Investigate a failed tool call</h2>
          <p>
            Find a failure in the Trajectory view, inspect the call and result, then open the linked
            record. Check the arguments, result, and surrounding conversation before attributing the
            failure to the agent. A missing result may mean the log is incomplete rather than that
            the tool never finished.
          </p>
          <p>
            Unquote surfaces integrity warnings where the log provides incomplete or inconsistent
            evidence. Invalid JSONL lines remain parse warnings and do not automatically disable an
            otherwise recognized session. Token usage and other metadata are shown only where the
            supported records provide them.
          </p>
        </section>
        <section>
          <h2>Supported logs and privacy</h2>
          <p>
            Agent detection supports recognized Codex rollout and Claude Code transcript records in
            JSONL. Other JSON and JSONL files can still be inspected in the general viewer. A new
            agent log format may need an updated adapter before a session view becomes available.
          </p>
          <p>
            Session logs can contain prompts, code, paths, and tool output. File contents stay in
            your browser. If you need to share a debugging excerpt, use the report tools to select
            source lines and redact specific paths, then review the exported result.
          </p>
        </section>
      </>
    ),
  },
} satisfies Record<string, Guide>;
