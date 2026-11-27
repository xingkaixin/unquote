import type { ReactNode } from "react";
import type { GuideLocale, GuideSlug } from "./site-links";

export interface GuideFaq {
  question: string;
  answer: string;
}

export interface GuideEntry {
  title: string;
  heading: string;
  description: string;
  summary: string;
  content: ReactNode;
  faqs: readonly GuideFaq[];
}

const sectionClass = "flex flex-col gap-3 border-t border-border pt-6";

const headingClass = "m-0 text-[16px] font-semibold text-text-primary";

const paragraphClass = "m-0 text-sm leading-[23px] text-text-secondary";

const listClass = "m-0 flex flex-col gap-2 pl-5 text-sm leading-[23px] text-text-secondary";

const preClass =
  "m-0 overflow-x-auto rounded-md border border-border bg-surface-100 p-3 font-mono text-xs leading-[23px] text-text-primary";

const captionClass = "mb-2 text-xs font-medium text-text-secondary";

export const guides: Readonly<Record<GuideSlug, Readonly<Record<GuideLocale, GuideEntry>>>> = {
  "jsonl-viewer": {
    en: {
      title: "JSONL Viewer Online: Open, Search & Inspect NDJSON Files | Unquote",
      heading: "Open and search JSONL / NDJSON files locally",
      description:
        "Free local JSONL & NDJSON viewer. Stream large logs and OpenAI Batch JSONL, expand escaped JSON strings, isolate invalid lines, filter tables, and export CSV.",
      summary:
        "Unquote is a free browser-based JSONL and NDJSON viewer. Paste records or drop a local file above—including OpenAI Batch API outputs and MCP logs—to browse each line as a tree, recursively expand escaped JSON strings, isolate invalid lines, and export filtered CSV tables locally.",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>How to open a JSONL file</h2>
            <ol className={listClass}>
              <li>
                Drop a local <code>.jsonl</code> or <code>.ndjson</code> file into the box above,
                choose a file, or paste records directly.
              </li>
              <li>
                Keep format detection on JSONL or Auto to parse each nonblank line as an independent
                record.
              </li>
              <li>
                Click any record to inspect nested objects, arrays, and stringified JSON fields in
                the tree view.
              </li>
              <li>
                Use search, regex, or jq-style paths to locate fields, or open Record Table to
                filter and export CSV.
              </li>
            </ol>
            <p className={paragraphClass}>
              A malformed line does not hide valid records. Unquote shows the parse error alongside
              the original source line while every other record stays searchable and readable.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>
              Expand escaped JSON in OpenAI Batch &amp; MCP JSONL logs
            </h2>
            <p className={paragraphClass}>
              OpenAI Batch API outputs, LLM evaluation datasets, and MCP tool logs often wrap tool
              call arguments as escaped JSON strings inside each JSONL line. Unquote parses every
              line independently and recursively expands nested JSON strings into a navigable tree.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  Before: raw JSONL line with nested escaped tool arguments
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"custom_id":"req-1","response":{"body":{"tool_call":"{\\"name\\":\\"lookup\\",\\"arguments\\":\\"{\\\\\\"id\\\\\\":42}\\"}"}}}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  After: recursively expanded tree ready to search and filter
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "custom_id": "req-1",\n  "response": {\n    "body": {\n      "tool_call": {\n        "name": "lookup",\n        "arguments": { "id": 42 }\n      }\n    }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>JSONL, NDJSON, and a JSON array</h2>
            <p className={paragraphClass}>
              JSONL (JSON Lines) and NDJSON both store one complete JSON value per line with no
              outer array brackets or trailing commas. Application logs, datasets, and LLM batch
              outputs use this format so records can be appended and streamed incrementally.
            </p>
            <figure className="m-0">
              <figcaption className={captionClass}>
                Two JSONL records, each on its own line
              </figcaption>
              <pre tabIndex={0} className={preClass}>
                <code>
                  {
                    '{"level":"info","message":"started"}\n{"level":"error","message":"request failed","status":503}'
                  }
                </code>
              </pre>
            </figure>
            <p className={paragraphClass}>
              Unquote preserves exact JSON number lexemes (such as 64-bit IDs) across tree display,
              search, copy, and export, and keeps every record linked to its source line number.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Analyze repeated fields and export excerpts</h2>
            <p className={paragraphClass}>
              For structured logs with repeated keys, open Record Table to pick up to 12 JSON paths
              as columns, view exact field type profiles across all valid records, and export
              matching rows as CSV. When sharing a bug report, select specific source lines and
              redact sensitive paths before downloading Markdown or JSONL.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Large files and browser privacy</h2>
            <p className={paragraphClass}>
              Local JSONL files stream through a background Web Worker with virtualized rendering
              and on-demand full record loading. All parsing, searching, filtering, and exporting
              happen inside your browser; imported file contents and filenames are never uploaded.
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "How do I open a .jsonl or .ndjson file without installing software?",
          answer:
            "Drop your .jsonl or .ndjson file directly into the Unquote input box on this page or click Choose file. Unquote streams and parses each line locally in your browser into a searchable tree, with no login, installation, or file upload required.",
        },
        {
          question:
            "Why do JSON validators fail with Unexpected non-whitespace character after JSON on JSONL?",
          answer:
            "Standard JSON parsers expect a single root object or array, so they fail as soon as line 2 begins. JSONL stores one complete JSON value per line without outer brackets or trailing commas. Unquote parses each nonblank line independently and isolates trailing commas or truncated lines with their source line numbers.",
        },
        {
          question: "Can Unquote open OpenAI Batch API JSONL output files?",
          answer:
            "Yes. Drop an OpenAI Batch .jsonl output file into Unquote to stream records locally, recursively expand escaped tool call arguments inside response bodies, project fields like custom_id and error status into a Record Table, and export filtered rows as CSV.",
        },
        {
          question: "Can Unquote open large JSONL files with malformed lines?",
          answer:
            "Yes. Local JSONL files are read incrementally in a background worker with virtualized rendering. If one line contains invalid JSON, Unquote marks only that line with its parse error and original text while keeping all valid records browsable and searchable.",
        },
        {
          question: "Are my JSONL logs uploaded to a server?",
          answer:
            "No. Unquote has no backend for user data. Pasted text and imported files stay in your browser memory during the session. Anonymous Umami page analytics record only page visits and basic feature actions, never your JSON content or filenames.",
        },
      ],
    },
    "zh-CN": {
      title: "JSONL 在线查看器：本地打开、检索与导出 NDJSON 文件 | Unquote",
      heading: "本地打开并检索 JSONL / NDJSON 大文件",
      description:
        "免费本地 JSONL / NDJSON 在线查看器。在浏览器中流式解析大文件与 OpenAI Batch JSONL、展开嵌套转义 JSON、隔离错误行、按列筛选并导出 CSV，全程不上传。",
      summary:
        "Unquote 是运行在本地浏览器中的免费 JSONL / NDJSON 查看器。直接在上方拖入文件或粘贴日志（包括 OpenAI Batch 输出和 MCP 日志），即可逐行树状浏览、递归展开转义 JSON、定位格式错误行并导出表格，全程不上传数据。",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>如何打开并检索 JSONL 文件</h2>
            <ol className={listClass}>
              <li>
                把本地 <code>.jsonl</code> 或 <code>.ndjson</code>{" "}
                文件直接拖进上方输入区，或点击“选择文件”导入。
              </li>
              <li>保持 JSONL 或自动识别模式，系统会将每个非空行解析为独立记录。</li>
              <li>点击任意记录查看树状结构，嵌套在字符串里的 JSON 会自动递归展开。</li>
              <li>使用关键词、正则或 jq 风格路径检索字段，或打开“记录表格”按列过滤并导出 CSV。</li>
            </ol>
            <p className={paragraphClass}>
              单行 JSON 格式损坏不会影响整份文件。Unquote
              会在出错行展示具体报错与原始行文本，其余有效记录仍可正常浏览、检索和导出。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>展开 OpenAI Batch 与 MCP JSONL 中的多层转义日志</h2>
            <p className={paragraphClass}>
              OpenAI Batch API 批量结果、评测数据集和 MCP
              工具日志常把工具调用参数作为转义字符串嵌在每行 JSONL 里。Unquote
              逐行独立解析，并自动递归展开多层转义 JSON 字符串，直接检索内层字段。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  展开前：含多层转义工具参数的原始 JSONL 行
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"custom_id":"req-1","response":{"body":{"tool_call":"{\\"name\\":\\"lookup\\",\\"arguments\\":\\"{\\\\\\"id\\\\\\":42}\\"}"}}}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  展开后：自动递归还原为可搜索、可筛选的结构树
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "custom_id": "req-1",\n  "response": {\n    "body": {\n      "tool_call": {\n        "name": "lookup",\n        "arguments": { "id": 42 }\n      }\n    }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>JSONL、NDJSON 与普通 JSON 数组的区别</h2>
            <p className={paragraphClass}>
              JSONL（JSON Lines）与 NDJSON 指同一种按行分隔的格式：每行都是一个完整 JSON
              值，行与行之间没有逗号，也不需要外层方括号。服务端日志、训练数据集和大模型批处理输出普遍采用该格式，方便按行追加和流式读取。
            </p>
            <figure className="m-0">
              <figcaption className={captionClass}>两条 JSONL 记录，每条独占一行</figcaption>
              <pre tabIndex={0} className={preClass}>
                <code>
                  {
                    '{"level":"info","message":"started"}\n{"level":"error","message":"request failed","status":503}'
                  }
                </code>
              </pre>
            </figure>
            <p className={paragraphClass}>
              Unquote 在解析、展示、复制和导出过程中完整保留大整数与数字原始字面量，避免 JavaScript
              精度丢失，并始终保留每条记录对应的源文件行号。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>按列体检、筛选与脱敏导出</h2>
            <p className={paragraphClass}>
              面对重复字段日志，可在“记录表格”中选取最多 12 个 JSON
              路径作为列，查看全部有效记录的字段类型统计（字段体检），并将命中行导出为
              CSV。需要外发排障片段时，可勾选源行号并指定脱敏路径，导出干净的 Markdown 或 JSONL
              报告。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>大文件性能与数据隐私</h2>
            <p className={paragraphClass}>
              本地 JSONL 文件通过后台 Web Worker
              流式读取配合虚拟化列表渲染，降低主线程卡顿。所有解析、搜索、筛选与导出都在浏览器本地执行，文件内容和文件名不会发送到任何服务器。
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "不装软件怎么直接打开 .jsonl 或 .ndjson 文件？",
          answer:
            "把 .jsonl 或 .ndjson 文件直接拖到本页上方的输入区，或点击“选择文件”。Unquote 会在浏览器本地逐行解析并生成可搜索的树状视图，无需安装客户端，也不会上传文件内容。",
        },
        {
          question: "为什么 JSONL 放进普通 JSON 校验工具会报 Unexpected non-whitespace character？",
          answer:
            "普通 JSON 解析器只接受单个根对象或根数组，读到第二行就会报语法错误。JSONL 每行一条独立 JSON 且行尾不加逗号。Unquote 会逐行独立解析，即使某行出现尾随逗号或截断损坏，也只标出对应行号而不影响其余记录。",
        },
        {
          question: "可以用 Unquote 查看 OpenAI Batch API 导出的 JSONL 结果文件吗？",
          answer:
            "可以。直接把 OpenAI Batch 的 .jsonl 文件拖入 Unquote，即可在本地流式浏览每条批处理记录、自动递归展开响应体里转义的工具调用参数，还能在记录表格中按 custom_id 和错误状态筛选并导出 CSV。",
        },
        {
          question: "JSONL 文件很大或者中间有坏行能打开吗？",
          answer:
            "可以。本地 JSONL 文件会通过后台 Worker 流式解析并虚拟化渲染。如果中间有某一行语法错误，Unquote 只会标记该行的解析错误和原始文本，其余有效记录仍可正常查看和检索。",
        },
        {
          question: "使用 Unquote 查看本地日志会上传数据吗？",
          answer:
            "不会。Unquote 没有接收用户数据的后端服务，粘贴文本和导入文件仅保留在浏览器内存中。站点的 Umami 统计只记录页面访问和基础功能点击，不采集任何日志内容或文件名。",
        },
      ],
    },
  },
  "json-unescape": {
    en: {
      title: "JSON Unescape Online: Expand Escaped & Stringified JSON | Unquote",
      heading: "Unescape stringified JSON into a searchable tree",
      description:
        "Free local JSON unescape tool. Recursively expand multi-layer escaped JSON strings in LLM API responses, MCP tool calls, webhooks, and logs in your browser.",
      summary:
        "Unquote recursively parses JSON stored inside escaped JSON strings—including double-encoded LLM API responses and MCP tool call arguments—and displays the result as a searchable tree locally in your browser without manually stripping backslashes.",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>What is stringified JSON?</h2>
            <p className={paragraphClass}>
              LLM APIs, MCP tool calls, webhooks, and message queues frequently serialize a JSON
              object as a string field—sometimes two or three layers deep. Quotes and newlines
              inside that field are escaped with backslashes, so a standard JSON formatter still
              shows it as an unreadable string.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  Before: multi-layer escaped MCP tool call arguments
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"tool":"mcp.github.search","arguments":"{\\"repo\\":\\"unquote\\",\\"query\\":\\"{\\\\\\"state\\\\\\":\\\\\\"open\\\\\\"}\\"}"}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  After: recursively expanded into a browsable object tree
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "tool": "mcp.github.search",\n  "arguments": {\n    "repo": "unquote",\n    "query": { "state": "open" }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>How to unescape nested JSON</h2>
            <ol className={listClass}>
              <li>
                Paste the escaped JSON payload or drop a log file into the viewer above (or click
                the sample button).
              </li>
              <li>
                Unquote detects valid JSON inside string fields and recursively expands nested
                layers into browsable objects and arrays.
              </li>
              <li>
                Search across inner keys and values, decode JWTs or Unix timestamps in the
                inspector, or compare two expanded payloads with Compare JSON.
              </li>
              <li>Copy a single subtree or export the expanded JSON / JSONL file.</li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Why parse layers instead of stripping backslashes?</h2>
            <p className={paragraphClass}>
              Regex search-and-replace on backslashes corrupts Windows file paths, regular
              expressions, Unicode escapes, and escaped line breaks. Unquote uses a real JSON parser
              at each nested layer, leaves ordinary text untouched, and preserves exact number
              lexemes so long 64-bit IDs never round.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Difference from a regular JSON formatter</h2>
            <p className={paragraphClass}>
              A JSON formatter only adds indentation while leaving stringified values collapsed as
              raw text. Unquote changes nested JSON strings into navigable tree nodes so you can
              search, jump by JSONPath, diff, and export the expanded structure locally.
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "How do I unescape double-encoded or nested JSON strings online?",
          answer:
            "Paste your JSON response or log line into the Unquote box above and click Parse. Unquote parses each valid JSON string recursively across nested layers into a structured tree, then lets you search inner keys or copy and export the expanded JSON locally.",
        },
        {
          question:
            "Why does JSON.parse fail with Unexpected token or Bad control character on escaped JSON?",
          answer:
            'Double-escaped quotes (\\"), unescaped newlines inside string literals, or stray backslashes commonly trigger JSON.parse SyntaxError failures. Unquote parses each layer with a strict JSON parser: valid nested JSON strings expand recursively while non-JSON or malformed strings stay intact instead of breaking the whole payload.',
        },
        {
          question: "Can Unquote unescape MCP tool call arguments and LLM API JSON responses?",
          answer:
            "Yes. OpenAI, Anthropic, and MCP tool calls frequently encode structured arguments and results as escaped JSON strings. Paste the raw response or log line above to recursively unescape nested layers, inspect inner fields, and copy clean JSON locally.",
        },
        {
          question: "Will JSON unescaping round large 64-bit integer IDs?",
          answer:
            "No. Unquote preserves original JSON number source lexemes through parsing, display, copying, and export. Large integers such as Snowflake or Stripe-style numeric IDs keep every digit intact instead of losing precision in JavaScript floating-point numbers.",
        },
        {
          question: "Is it safe to paste production API responses with tokens or payloads?",
          answer:
            "Parsing runs 100% locally in your browser with no server upload or cloud storage. If you need to share an excerpt with teammates, use Export problem excerpt to redact specified paths before copying or downloading Markdown or JSONL.",
        },
      ],
    },
    "zh-CN": {
      title: "JSON 去转义在线工具：递归展开字符串化嵌套 JSON | Unquote",
      heading: "把转义 JSON 字符串展开为可检索的结构树",
      description:
        "免费本地 JSON 去转义工具。自动递归展开大模型 API 响应、MCP 工具调用、Webhook 和日志中的多层转义 JSON 字符串，支持搜索、Diff 与导出，全程本地运行。",
      summary:
        "Unquote 能自动识别并递归解析藏在 JSON 字符串里的多层转义 JSON（常见于大模型 API 响应与 MCP 工具调用参数），直接展开为可浏览、可搜索的树状结构，无需手动删反斜杠，数据完全留在本地浏览器。",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>什么是字符串化（转义）JSON？</h2>
            <p className={paragraphClass}>
              在大模型 API 响应、MCP 工具调用参数、微服务日志与 Webhook 回调中，经常会把整段 JSON
              二次甚至三次序列化成字符串放进某个字段里。普通 JSON 格式化工具只会把它当成满屏{" "}
              <code>\"</code> 的纯文本展示。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  展开前：多层转义的 MCP 工具调用参数字符串
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"tool":"mcp.github.search","arguments":"{\\"repo\\":\\"unquote\\",\\"query\\":\\"{\\\\\\"state\\\\\\":\\\\\\"open\\\\\\"}\\"}"}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>展开后：逐层递归还原为可浏览对象树</figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "tool": "mcp.github.search",\n  "arguments": {\n    "repo": "unquote",\n    "query": { "state": "open" }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>如何递归展开嵌套转义 JSON</h2>
            <ol className={listClass}>
              <li>把完整的转义 JSON 响应或日志粘贴到上方输入框，或直接点击示例一键体验。</li>
              <li>Unquote 会逐层解析有效 JSON 字符串，将其展开为可折叠、可搜索的对象与数组。</li>
              <li>
                支持在展开后的内层字段里直接搜索、按 JSONPath 跳转，也能解码 JWT / 时间戳或做 JSON
                结构对比（Diff）。
              </li>
              <li>一键复制单个节点值，或导出完整的展开后 JSON / JSONL 文件。</li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>为什么不能直接批量替换反斜杠？</h2>
            <p className={paragraphClass}>
              粗暴删除 <code>\</code> 会破坏文件路径、正则表达式、Unicode 转义序列和换行符。Unquote
              逐层按 JSON 语法严格解析，只展开合法 JSON 字符串，普通文本保持原样，且完整保留 64
              位长整数原始字面量不丢精度。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>和普通 JSON 格式化工具的区别</h2>
            <p className={paragraphClass}>
              常规格式化工具只调整缩进，字符串里的转义 JSON 依然是一坨文字。Unquote
              把多层嵌套字符串真正还原成结构化节点，并支持大文件 JSONL、SSE 流与结构 Diff。
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "多层嵌套转义的 JSON 字符串怎么在线展开？",
          answer:
            "把包含转义字符串的完整 JSON 粘贴到本页上方输入框并点击解析即可。Unquote 会自动逐层识别合法的嵌套 JSON 字符串并递归展开为树状结构，方便直接搜索内层字段或导出结果。",
        },
        {
          question:
            "为什么转义 JSON 用 JSON.parse 会报 Unexpected token 或 Bad control character？",
          answer:
            '常见原因是多层转义引号（\\"）、字符串内夹杂未转义换行符或非法反斜杠导致语法错误。Unquote 逐层使用严格 JSON 解析器：合法的嵌套 JSON 字符串会自动递归展开，不合法或普通文本字符串则原样保留，不会拖垮整条报文。',
        },
        {
          question: "可以直接展开 MCP 工具调用参数或大模型 API 返回的转义 JSON 吗？",
          answer:
            "可以。OpenAI、Claude 和 MCP 工具调用常把结构化参数与结果二次序列化成转义字符串。直接粘贴原始报文即可递归展开多层嵌套字段，并在本地搜索、Diff 对比或导出干净的 JSON。",
        },
        {
          question: "展开转义 JSON 时大整数 ID 会丢失精度吗？",
          answer:
            "不会。Unquote 在解析、界面展示、复制和导出全链路保留 JSON 数字的原始字面量，雪花 ID 等超过 JavaScript 安全整数范围的数字都不会被四舍五入。",
        },
        {
          question: "粘贴带敏感字段的线上接口响应安全吗？",
          answer:
            "安全。所有解析、展开和对比都在浏览器本地执行，不会上传到任何服务器。如需把结果发给同事排障，还可以使用“导出问题片段”功能按路径脱敏后再导出。",
        },
      ],
    },
  },
  "agent-log-viewer": {
    en: {
      title: "Claude Code & Codex JSONL Log Viewer: MCP & Agent Logs | Unquote",
      heading: "Claude Code, Codex, and MCP JSONL log viewer",
      description:
        "Local Claude Code & Codex JSONL log viewer. Unescape MCP tool call JSON, trace turns, failures, and token usage, or open OpenAI Batch JSONL in your browser.",
      summary:
        "Unquote is a local Claude Code JSONL viewer and Codex rollout log viewer that also unescapes nested MCP tool call JSON. Drop a session log above to follow turns, inspect tool failures and token usage in Trajectory view, and export redacted Markdown reports—without uploading private code.",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>How to open Codex or Claude Code logs</h2>
            <ol className={listClass}>
              <li>
                Drop a local Codex rollout JSONL or Claude Code transcript JSONL file (for example
                from <code>~/.codex/sessions/</code> or <code>~/.claude/projects/</code>) into the
                box above.
              </li>
              <li>
                Unquote detects recognized session schemas automatically and opens the Agent
                conversation view while keeping JSONL parsing intact.
              </li>
              <li>
                Switch to Trajectory to inspect timed model and tool activity, filter failed tool
                calls, and inspect per-tool duration breakdowns.
              </li>
              <li>
                Click any message, tool call, or trajectory event to jump straight to its linked
                source JSONL record and line number.
              </li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Unescape nested MCP &amp; Agent tool call JSON</h2>
            <p className={paragraphClass}>
              Agent transcripts and MCP tool logs frequently store tool arguments and outputs as
              multi-layer escaped JSON strings. Unquote recursively unescapes every nested layer
              automatically so you can read parameters and search inner keys directly.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  Before: raw Agent JSONL record with escaped MCP tool arguments
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"type":"function_call","name":"mcp.billing.search","arguments":"{\\"customerId\\":\\"cus_42\\",\\"filters\\":\\"{\\\\\\"status\\\\\\":\\\\\\"open\\\\\\"}\\"}"}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  After: recursively expanded arguments in Agent &amp; JSON views
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "type": "function_call",\n  "name": "mcp.billing.search",\n  "arguments": {\n    "customerId": "cus_42",\n    "filters": { "status": "open" }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Three views backed by the same source lines</h2>
            <dl className="m-0 grid gap-3 text-sm leading-[23px]">
              <div>
                <dt className="font-semibold text-text-primary">
                  Agent view — follow the conversation and tool calls
                </dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  Groups user prompts, assistant replies, reasoning summaries, tool calls, and
                  paired results by turn, expanding stringified MCP and shell tool arguments
                  automatically.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">
                  Trajectory view — debug latency, retries, and failures
                </dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  Plots model and tool lanes on a zoomable timeline, compresses long idle gaps,
                  tracks token usage and API errors, and highlights unpaired or failed tool calls.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">
                  JSON view — verify raw log evidence
                </dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  Inspect exact raw records, search nested fields across thousands of lines, and
                  check integrity warnings when a log is incomplete.
                </dd>
              </div>
            </dl>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Export clean turn reports with redaction</h2>
            <p className={paragraphClass}>
              Select specific turns in the Agent view to export a Markdown turn report built from
              full source records with line numbers. Tool calls pair with results strictly via
              recorded call IDs, and you can redact sensitive JSON paths before copying or
              downloading.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Supported formats and local privacy</h2>
            <p className={paragraphClass}>
              Agent and Trajectory views activate for recognized Codex rollout and Claude Code
              transcript JSONL records. Other AI logs—including standalone MCP tool logs and OpenAI
              Batch JSONL files—open cleanly in the general JSONL tree viewer with automatic
              recursive stringified JSON expansion. Because coding agent logs often include prompts,
              source code, and secrets, all processing runs locally in your browser with zero
              upload.
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "How do I view Claude Code or Codex JSONL session logs locally?",
          answer:
            "Drag a Claude Code transcript JSONL file (typically under ~/.claude/projects/) or a Codex rollout JSONL file (under ~/.codex/sessions/) into Unquote above. It detects the session format locally and renders Agent conversation, Trajectory timeline, and raw JSONL views.",
        },
        {
          question:
            "Can Unquote unescape nested MCP tool call JSON or open OpenAI Batch JSONL files?",
          answer:
            "Yes. Unquote recursively unescapes stringified JSON inside MCP tool call arguments and results across Codex, Claude Code, and generic JSONL logs. OpenAI Batch JSONL files open in the local JSONL viewer where you can expand escaped arguments, filter by custom_id in Record Table, and export CSV.",
        },
        {
          question: "Does Unquote show tool call arguments, failures, and token usage?",
          answer:
            "Yes. Unquote pairs tool calls with tool results using recorded call IDs, automatically expands stringified JSON arguments, surfaces API errors and failed calls in the Trajectory view, and displays token usage wherever the session log records it.",
        },
        {
          question: "Are my private coding prompts or repository contents uploaded?",
          answer:
            "Never. Unquote parses the entire JSONL log locally inside your browser. When you need to share a debugging excerpt, you can export selected turns as Markdown and redact sensitive paths before sharing.",
        },
      ],
    },
    "zh-CN": {
      title: "Claude Code 与 Codex JSONL 日志查看器：MCP 工具调用与轨迹 | Unquote",
      heading: "本地查看 Claude Code、Codex 与 MCP JSONL 日志",
      description:
        "本地解析 Claude Code transcript 与 Codex rollout JSONL 日志。自动展开 MCP 工具调用多层转义 JSON、排查失败与 Token 轨迹，也支持浏览 OpenAI Batch JSONL。",
      summary:
        "Unquote 是纯本地的 Claude Code 与 Codex JSONL 日志查看器，支持自动递归展开 MCP 工具调用中的多层转义 JSON。把本地会话文件拖到上方即可按轮次查看对话、在 Trajectory 轨迹视图排查失败和耗时，并导出脱敏报告，全程不上传代码。",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>如何打开 Codex / Claude Code 会话日志</h2>
            <ol className={listClass}>
              <li>
                把本地 Codex rollout 日志（如 <code>~/.codex/sessions/</code>）或 Claude Code
                会话记录（如 <code>~/.claude/projects/</code>）的 <code>.jsonl</code>{" "}
                文件直接拖进上方输入区。
              </li>
              <li>Unquote 会自动识别会话结构，默认进入 Agent 对话视图，同时保留原始 JSONL 树。</li>
              <li>
                切换到“轨迹（Trajectory）”查看模型与工具调用时间线、筛选失败项及各工具耗时分布。
              </li>
              <li>点击任意消息、工具卡片或轨迹事件，均可直接跳回产生该内容的原始 JSONL 行。</li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>自动递归展开 MCP 与 Agent 工具调用转义 JSON</h2>
            <p className={paragraphClass}>
              Agent 会话记录与 MCP 工具调用经常把参数和返回值多层转义成 JSON 字符串。Unquote
              会在解析时自动逐层展开，无需手动复制去反斜杠即可直接阅读并检索内层字段。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  展开前：含多层转义 MCP 参数的原始 Agent JSONL 记录
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{"type":"function_call","name":"mcp.billing.search","arguments":"{\\"customerId\\":\\"cus_42\\",\\"filters\\":\\"{\\\\\\"status\\\\\\":\\\\\\"open\\\\\\"}\\"}"}'
                    }
                  </code>
                </pre>
              </figure>
              <figure className="m-0 min-w-0">
                <figcaption className={captionClass}>
                  展开后：Agent 与 JSON 视图中自动还原的结构化参数
                </figcaption>
                <pre tabIndex={0} className={preClass}>
                  <code>
                    {
                      '{\n  "type": "function_call",\n  "name": "mcp.billing.search",\n  "arguments": {\n    "customerId": "cus_42",\n    "filters": { "status": "open" }\n  }\n}'
                    }
                  </code>
                </pre>
              </figure>
            </div>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>三种视图联动，始终可追溯原始行</h2>
            <dl className="m-0 grid gap-3 text-sm leading-[23px]">
              <div>
                <dt className="font-semibold text-text-primary">
                  Agent 视图 — 按轮次阅读对话与工具调用
                </dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  按 Turn 归组用户提示、助手回复、推理摘要、工具调用与配对结果，自动展开转义的 MCP
                  与命令行工具参数 JSON。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">
                  轨迹（Trajectory）视图 — 定位失败、重试与耗时瓶颈
                </dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  在可缩放时间线上展示活动/模型/工具泳道，压缩长空闲间隔，汇总 Token 消耗、API
                  错误与失败调用。
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">JSON 视图 — 核对原始日志证据</dt>
                <dd className="m-0 mt-1 text-text-secondary">
                  查看每条原始记录结构、跨数千行检索嵌套字段，并展示日志缺失或未配对调用的完整性警告。
                </dd>
              </div>
            </dl>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>勾选轮次，导出可脱敏的 Markdown 报告</h2>
            <p className={paragraphClass}>
              在 Agent 视图中勾选需要复盘的轮次，即可基于完整源记录生成带行号的 Markdown
              轮次报告。工具调用与结果严格依据日志里的 call id
              配对，导出前可指定脱敏路径隐藏密钥或路径信息。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>支持范围与隐私保障</h2>
            <p className={paragraphClass}>
              Agent 与轨迹视图专门适配 Codex rollout 与 Claude Code transcript JSONL 格式；其他独立
              MCP 工具日志和 OpenAI Batch JSONL 文件也可在通用 JSONL
              视图中完整浏览并自动递归展开转义 JSON。会话日志通常包含私有代码与提示词，Unquote
              全程在浏览器本地处理，不经过任何服务端。
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "怎么在本地查看 Claude Code 或 Codex 的 JSONL 会话日志？",
          answer:
            "直接把 ~/.claude/projects/ 下的 Claude Code transcript 或 ~/.codex/sessions/ 下的 Codex rollout JSONL 文件拖到本页上方即可。Unquote 会在本地自动识别格式，展示对话视图、轨迹时间线和原始 JSONL 记录。",
        },
        {
          question: "支持展开 MCP 工具调用转义 JSON 或查看 OpenAI Batch JSONL 吗？",
          answer:
            "支持。Unquote 会在 Codex、Claude Code 和通用 JSONL 日志中自动递归展开 MCP 工具调用参数与结果里的多层转义 JSON；OpenAI Batch JSONL 也会在通用 JSONL 视图中流式打开，支持按 custom_id 筛选并导出 CSV。",
        },
        {
          question: "可以查看工具调用参数、失败原因和 Token 统计吗？",
          answer:
            "可以。Unquote 会根据日志中的 call id 自动配对工具调用与结果、递归展开转义的工具参数，并在轨迹视图中按工具统计调用次数、耗时、失败项以及日志记录的 Token 用量。",
        },
        {
          question: "日志里包含公司代码和私有 Prompt，会上传到云端吗？",
          answer:
            "完全不会。所有文件读取、解析、检索和报告生成都在本地浏览器完成。若需分享排障记录，可使用轮次报告导出并指定脱敏路径后再复制或下载。",
        },
      ],
    },
  },
  "sse-viewer": {
    en: {
      title: "SSE Viewer Online: Parse text/event-stream & LLM Streaming JSON | Unquote",
      heading: "Parse and inspect SSE (text/event-stream) responses locally",
      description:
        "Free online SSE viewer for Server-Sent Events and LLM streaming API responses. Parse data: and event: blocks, expand nested stringified JSON, and search events locally.",
      summary:
        "Unquote parses Server-Sent Events (text/event-stream) into individual records and recursively expands JSON—and stringified tool-call JSON—inside every data: field. Paste an OpenAI, Anthropic, or DevTools SSE capture above to inspect, filter, and export locally in your browser.",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>Why standard JSON viewers fail on SSE streams</h2>
            <p className={paragraphClass}>
              LLM streaming APIs (OpenAI Responses, Chat Completions, Anthropic Messages, MCP
              transports) return <code>text/event-stream</code> payloads with <code>event:</code>,{" "}
              <code>id:</code>, and <code>data:</code> prefixes plus terminal markers such as{" "}
              <code>data: [DONE]</code>. Standard JSON formatters reject the whole response as
              invalid syntax.
            </p>
            <figure className="m-0">
              <figcaption className={captionClass}>
                Example SSE stream with nested stringified JSON arguments
              </figcaption>
              <pre tabIndex={0} className={preClass}>
                <code>
                  {
                    'event: response.output_item.added\ndata: {"type":"function_call","arguments":"{\\"customerId\\":\\"cus_42\\"}"}\n\ndata: [DONE]'
                  }
                </code>
              </pre>
            </figure>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>How to inspect an SSE response</h2>
            <ol className={listClass}>
              <li>
                Copy the raw <code>text/event-stream</code> response from Chrome DevTools, curl, or
                your proxy capture and paste it above (or drop a <code>.sse</code> /{" "}
                <code>.log</code> file).
              </li>
              <li>
                Unquote follows WHATWG SSE rules: multiline <code>data:</code> fields are joined
                with <code>\n</code>, comments starting with <code>:</code> are skipped, and each
                event block becomes one record with its starting line number.
              </li>
              <li>
                JSON inside <code>data</code>—and stringified JSON inside tool arguments—expands
                into a searchable tree automatically. Non-JSON payloads like <code>[DONE]</code>{" "}
                remain readable strings without failing the stream.
              </li>
              <li>
                Search across events, compare two events with Compare JSON, or project fields into a
                Record Table and export CSV.
              </li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Built for capture logs and trailing events</h2>
            <p className={paragraphClass}>
              Unlike a live browser <code>EventSource</code>, Unquote still dispatches the final
              event block even if a copied capture does not end with a trailing blank line. Each
              event stays an independent record rather than mutating or stitching deltas together,
              so you see the exact wire payload.
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>Local browser processing</h2>
            <p className={paragraphClass}>
              SSE captures often contain user prompts, tool outputs, and API metadata. Unquote
              parses streams inside a local browser Web Worker without uploading your payload to any
              server.
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "How do I view an OpenAI or Anthropic SSE (text/event-stream) response?",
          answer:
            "Paste the raw text/event-stream response from DevTools, curl, or a proxy log into Unquote above. It parses each event: and data: block into a separate record, expands JSON inside data fields, and handles non-JSON markers like [DONE] cleanly.",
        },
        {
          question: "Does Unquote expand escaped JSON inside SSE tool call arguments?",
          answer:
            "Yes. After parsing each SSE event's data field as JSON, Unquote recursively expands stringified JSON values inside it—such as LLM function call arguments—so you can inspect and search nested parameters directly in the tree.",
        },
        {
          question: "Does Unquote merge streaming delta chunks into one message?",
          answer:
            "No. Each SSE event block stays a faithful, independent record linked to its original starting line number. This lets you debug exact event order, fields, usage payloads, and malformed chunks without hiding wire-level details.",
        },
      ],
    },
    "zh-CN": {
      title: "SSE 流式响应在线解析器：查看 text/event-stream 与大模型流式 JSON | Unquote",
      heading: "在本地解析并查看 SSE（text/event-stream）流式响应",
      description:
        "免费本地 SSE 在线查看器，专治大模型流式接口与抓包日志。按事件块解析 event:/data: 字段，递归展开嵌套转义 JSON，支持检索、表格导出，全程本地不上传。",
      summary:
        "Unquote 按 WHATWG 规范把 Server-Sent Events（text/event-stream）拆分为逐条事件记录，并自动展开每个 data 字段里的 JSON 以及工具调用转义参数。直接粘贴 OpenAI、Claude 或抓包工具里的流式响应即可本地排障。",
      content: (
        <>
          <section className={sectionClass}>
            <h2 className={headingClass}>为什么普通 JSON 格式化工具打不开 SSE？</h2>
            <p className={paragraphClass}>
              大模型流式接口（OpenAI Responses / Chat Completions、Anthropic Messages、MCP
              等）返回的是 <code>text/event-stream</code> 文本，包含 <code>event:</code>、
              <code>id:</code>、<code>data:</code> 前缀以及 <code>data: [DONE]</code> 结束标记，普通
              JSON 校验器会直接报错。
            </p>
            <figure className="m-0">
              <figcaption className={captionClass}>
                包含嵌套转义工具参数的 SSE 流式响应示例
              </figcaption>
              <pre tabIndex={0} className={preClass}>
                <code>
                  {
                    'event: response.output_item.added\ndata: {"type":"function_call","arguments":"{\\"customerId\\":\\"cus_42\\"}"}\n\ndata: [DONE]'
                  }
                </code>
              </pre>
            </figure>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>如何在线解析 SSE 流式日志</h2>
            <ol className={listClass}>
              <li>
                从浏览器 DevTools、curl 或抓包工具复制完整的 <code>text/event-stream</code>{" "}
                响应，粘贴到上方输入框（或拖入 <code>.sse</code> / <code>.log</code> 文件）。
              </li>
              <li>
                Unquote 按 WHATWG SSE 规范解析：连续的 <code>data:</code> 行以 <code>\n</code>{" "}
                拼接，忽略 <code>:</code> 注释行，每个事件块生成一条带起始行号的独立记录。
              </li>
              <li>
                <code>data</code> 里的 JSON 以及嵌套的工具调用参数会自动递归展开为树；
                <code>[DONE]</code> 等非 JSON 文本原样保留为字符串，不会导致解析失败。
              </li>
              <li>
                支持全文搜索、正则/路径检索、记录表格投影导出 CSV，以及对比任意两条事件的结构差异。
              </li>
            </ol>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>适配抓包片段，保留原始事件语义</h2>
            <p className={paragraphClass}>
              即使复制的抓包文本末尾没有空行，Unquote
              也会正确派发最后一个事件，避免丢失关键收尾数据。每个事件保持独立记录而不擅自拼接
              delta，确保看到的与真实网络响应完全一致。
            </p>
          </section>
          <section className={sectionClass}>
            <h2 className={headingClass}>浏览器本地 Worker 解析，不上传接口数据</h2>
            <p className={paragraphClass}>
              流式抓包通常带有用户对话、业务参数和模型元信息。Unquote 在本地 Web Worker
              中流式解析全部事件，不向任何服务器发送输入内容。
            </p>
          </section>
        </>
      ),
      faqs: [
        {
          question: "怎么直接查看 OpenAI 或 Claude 的 SSE（text/event-stream）流式响应？",
          answer:
            "把 DevTools、curl 或抓包工具里复制的 text/event-stream 原始响应直接粘贴到上方输入框即可。Unquote 会把每个 event:/data: 事件块解析为独立记录，自动展开 data 里的 JSON，并正常保留 [DONE] 等非 JSON 标记。",
        },
        {
          question: "SSE 事件里的工具调用转义 JSON 参数也能自动展开吗？",
          answer:
            "可以。Unquote 在解析完每个 SSE 事件的 data JSON 后，会继续递归展开其中的字符串化 JSON（例如 function_call 的 arguments 字段），直接在树状视图里浏览和搜索参数。",
        },
        {
          question: "Unquote 会把流式输出的 delta 增量自动拼成一整段话吗？",
          answer:
            "不会。Unquote 保持每个 SSE 事件为独立记录并保留源行号，不篡改或臆测重组增量，方便开发者精确排查事件顺序、字段结构、用量统计和异常分片。",
        },
      ],
    },
  },
};
