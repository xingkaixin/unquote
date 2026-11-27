import type { Locale } from "@unquote/ui/i18n";
import type { GuideLocale } from "./site-links";

export interface WelcomeFaq {
  question: string;
  answer: string;
}

export interface WelcomeCopy {
  guidesTitle: string;
  guidesLocale: GuideLocale;
  jsonlGuide: string;
  unescapeGuide: string;
  agentGuide: string;
  sseGuide: string;
  exampleTitle: string;
  exampleDescription: string;
  before: string;
  after: string;
  tryExample: string;
  formattingTitle: string;
  formattingDescription: string;
  jsonlTitle: string;
  jsonlDescription: string;
  sseTitle: string;
  sseDescription: string;
  localTitle: string;
  localDescription: string;
  faqTitle: string;
  faqs: readonly WelcomeFaq[];
  extensionTitle: string;
  extensionDescription: string;
  chromeLink: string;
  edgeLink: string;
  githubLink: string;
  enableJavaScript: string;
}

export const welcomeCopy: Readonly<Record<Locale, WelcomeCopy>> = {
  en: {
    guidesTitle: "Tools & Guides",
    guidesLocale: "en",
    jsonlGuide: "JSONL / NDJSON viewer",
    unescapeGuide: "JSON unescape",
    agentGuide: "Codex & Claude Code log viewer",
    sseGuide: "SSE stream viewer",
    exampleTitle: "See escaped JSON as structured data",
    exampleDescription:
      "The body field starts as a JSON string. Unquote expands it into an object you can browse, search, diff, and export.",
    before: "Original JSON",
    after: "Expanded JSON",
    tryExample: "Try this example",
    formattingTitle: "More than a JSON formatter",
    formattingDescription:
      "A formatter changes indentation. Unquote recursively parses JSON stored inside strings, preserves exact 64-bit numbers, and decodes JWTs and timestamps in the inspector.",
    jsonlTitle: "Stream large JSONL, isolate invalid lines",
    jsonlDescription:
      "Each JSONL line is an independent record. Valid records remain readable when another line fails; filter repeated fields in a Record Table and export CSV.",
    sseTitle: "Parse SSE (text/event-stream) responses",
    sseDescription:
      "Paste OpenAI, Anthropic, or DevTools SSE captures. Each event block becomes a record with stringified tool-call arguments expanded automatically.",
    localTitle: "100% local in your browser, built for Agent logs",
    localDescription:
      "Pasted text and imported files stay in your browser without uploading. Recognized Codex rollout and Claude Code JSONL sessions unlock Agent and Trajectory views.",
    faqTitle: "Frequently asked questions",
    faqs: [
      {
        question: "What makes Unquote different from a standard JSON formatter?",
        answer:
          "A standard formatter only indents outer JSON and leaves escaped JSON strings as raw text. Unquote recursively parses nested stringified JSON, streams large JSONL and SSE files, preserves exact 64-bit numbers, and builds Agent and Trajectory views for Codex and Claude Code logs.",
      },
      {
        question: "Does Unquote upload my JSON, JSONL, or Agent session logs?",
        answer:
          "No. All parsing, searching, diffing, and exporting run locally inside your browser or browser extension with no backend storage. You can also redact specified JSON paths before exporting Markdown or JSONL excerpts.",
      },
      {
        question: "Which formats and browser extensions does Unquote support?",
        answer:
          "Unquote supports JSON, JSONL / NDJSON, WHATWG SSE (text/event-stream), and automatic Agent session detection for Codex rollout and Claude Code transcript JSONL logs. It is available free on the web and as Chrome and Edge extensions.",
      },
    ],
    extensionTitle: "Browser extensions & open source",
    extensionDescription:
      "Open JSON responses, local files, or selected text in one click with the free Unquote browser extension.",
    chromeLink: "Chrome Web Store",
    edgeLink: "Edge Add-ons",
    githubLink: "GitHub",
    enableJavaScript:
      "Enable JavaScript to paste JSON, JSONL, or SSE, open local files, and use the interactive viewer.",
  },
  "zh-CN": {
    guidesTitle: "场景工具与指南",
    guidesLocale: "zh-CN",
    jsonlGuide: "JSONL / NDJSON 查看器",
    unescapeGuide: "JSON 去转义展开",
    agentGuide: "Codex 与 Claude Code 日志查看",
    sseGuide: "SSE 流式响应解析",
    exampleTitle: "从转义字符串到结构化数据",
    exampleDescription:
      "body 字段原本是转义 JSON 字符串。Unquote 会递归展开为结构树，方便浏览、搜索、Diff 对比和导出。",
    before: "原始 JSON",
    after: "展开后的 JSON",
    tryExample: "试用这个示例",
    formattingTitle: "不止是 JSON 格式化",
    formattingDescription:
      "普通格式化只调缩进；Unquote 递归解析嵌套转义 JSON，完整保留 64 位长整数精度，并支持检查器内联解码 JWT 与时间戳。",
    jsonlTitle: "流式查看 JSONL 大文件，隔离错误行",
    jsonlDescription:
      "JSONL 每行是独立记录，单行损坏不影响其余数据；还可在记录表格中按列体检、筛选并导出 CSV。",
    sseTitle: "原生解析 SSE（text/event-stream）流式响应",
    sseDescription:
      "直接粘贴 OpenAI、Claude 或抓包工具里的流式事件流，每个事件独立成条并自动展开嵌套工具调用参数。",
    localTitle: "纯本地运行，专为 Agent 会话日志打造",
    localDescription:
      "粘贴文本和本地文件全程不上传。自动识别 Codex rollout 与 Claude Code JSONL 会话，提供 Agent 对话与 Trajectory 轨迹视图。",
    faqTitle: "常见问题",
    faqs: [
      {
        question: "Unquote 和普通 JSON 格式化工具的区别是什么？",
        answer:
          "普通格式化工具只缩进外层结构，字符串里的转义 JSON 依然是一段文本。Unquote 会递归展开嵌套转义 JSON、流式解析大 JSONL 和 SSE 事件流、保留 64 位长整数精度，并为 Codex 和 Claude Code 日志提供对话与轨迹视图。",
      },
      {
        question: "使用 Unquote 会上传我的日志或接口数据吗？",
        answer:
          "不会。所有解析、搜索、对比和导出都在浏览器或扩展本地完成，没有后端存储。需要外发排障片段时，还可以按 JSON 路径脱敏后再导出 Markdown 或 JSONL。",
      },
      {
        question: "Unquote 支持哪些格式和浏览器扩展？",
        answer:
          "支持 JSON、JSONL / NDJSON、WHATWG SSE（text/event-stream），并自动识别 Codex rollout 和 Claude Code transcript JSONL 会话日志。除网页版外，还免费提供 Chrome 与 Edge 浏览器扩展。",
      },
    ],
    extensionTitle: "浏览器扩展与开源地址",
    extensionDescription:
      "安装免费的 Unquote 扩展，一键在本地查看网页接口响应、本地文件或选中文本。",
    chromeLink: "Chrome 应用商店",
    edgeLink: "Edge 加载项",
    githubLink: "GitHub 源码",
    enableJavaScript:
      "启用 JavaScript 后，即可粘贴 JSON、JSONL 或 SSE、打开本地文件并使用交互式查看器。",
  },
  ja: {
    guidesTitle: "ガイドとツール（英語）",
    guidesLocale: "en",
    jsonlGuide: "JSONL / NDJSON ビューアー",
    unescapeGuide: "エスケープされた JSON を展開",
    agentGuide: "Codex / Claude Code ログビューアー",
    sseGuide: "SSE ストリームビューアー",
    exampleTitle: "エスケープされた文字列を構造化データに",
    exampleDescription:
      "body フィールドは JSON 文字列です。Unquote はこれをオブジェクトに展開し、閲覧・検索・比較・エクスポートできるようにします。",
    before: "元の JSON",
    after: "展開後の JSON",
    tryExample: "このサンプルを試す",
    formattingTitle: "JSON の整形だけではありません",
    formattingDescription:
      "整形はインデントを揃えます。Unquote は文字列内の JSON も再帰的に解析し、大きな整数精度を保ちつつ JWT やタイムスタンプもデコードします。",
    jsonlTitle: "無効な行を含む大きな JSONL も確認",
    jsonlDescription:
      "JSONL の各行は独立したレコードです。一部の行が壊れていても他の行を閲覧でき、レコード表での絞り込みや CSV 出力にも対応します。",
    sseTitle: "SSE（text/event-stream）レスポンスを解析",
    sseDescription:
      "OpenAI や Anthropic、DevTools からコピーした SSE ストリームをイベントごとに分割し、ネストされたツール引数の JSON も自動展開します。",
    localTitle: "ブラウザー内で完結、エージェントログにも対応",
    localDescription:
      "貼り付けたテキストとファイルはアップロードせずローカルで解析します。Codex と Claude Code の JSONL セッションでは Agent と Trajectory ビューを利用できます。",
    faqTitle: "よくある質問",
    faqs: [
      {
        question: "通常の JSON フォーマッターとの違いは何ですか？",
        answer:
          "通常のフォーマッターは外側のインデントだけを整え、エスケープされた JSON 文字列はそのまま残します。Unquote は文字列内の JSON を再帰的に展開し、JSONL や SSE の解析、64 ビット数値の保持、Codex / Claude Code の軌跡表示までローカルで行えます。",
      },
      {
        question: "貼り付けた JSON やログはサーバーに送信されますか？",
        answer:
          "いいえ。解析・検索・比較・エクスポートはすべてブラウザーまたは拡張機能内でローカル実行されます。共有用の抜粋には指定パスをマスクして出力する機能もあります。",
      },
      {
        question: "対応している形式とブラウザー拡張機能は？",
        answer:
          "JSON、JSONL / NDJSON、WHATWG SSE（text/event-stream）に対応し、Codex rollout と Claude Code transcript の JSONL を自動認識します。Web 版に加えて Chrome / Edge 拡張機能も無料で利用できます。",
      },
    ],
    extensionTitle: "ブラウザー拡張機能とオープンソース",
    extensionDescription:
      "無料の Unquote 拡張機能を使うと、API レスポンスや選択テキストをワンクリックでローカルビューアーに開けます。",
    chromeLink: "Chrome ウェブストア",
    edgeLink: "Edge アドオン",
    githubLink: "GitHub",
    enableJavaScript:
      "JavaScript を有効にすると、JSON・JSONL・SSE の貼り付け、ローカルファイルの読み込み、ビューアーの操作ができます。",
  },
};
