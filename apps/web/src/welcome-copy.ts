import type { Locale } from "@unquote/ui/i18n";

export const welcomeCopy = {
  en: {
    exampleTitle: "See escaped JSON as structured data",
    exampleDescription:
      "The body field starts as a JSON string. Unquote expands it into an object you can browse, search, and export.",
    before: "Original JSON",
    after: "Expanded JSON",
    tryExample: "Try this example",
    formattingTitle: "More than a JSON formatter",
    formattingDescription:
      "A formatter changes indentation. Unquote also recursively parses JSON stored inside strings, so nested objects and arrays can be explored as a tree.",
    jsonlTitle: "Read JSONL, including invalid lines",
    jsonlDescription:
      "Each JSONL line is a separate record. Valid records remain readable when another line fails; inspect failed records to find the parse error and original line.",
    localTitle: "Your data stays in your browser",
    localDescription:
      "Pasted text and imported files are parsed locally, without uploading their contents. Recognized Codex and Claude Code JSONL sessions also have Agent and Trajectory views.",
    enableJavaScript:
      "Enable JavaScript to paste JSON, open local files, and use the interactive viewer.",
  },
  "zh-CN": {
    exampleTitle: "从转义字符串到结构化数据",
    exampleDescription:
      "body 字段原本是 JSON 字符串。Unquote 将它展开为对象，方便浏览、搜索和导出。",
    before: "原始 JSON",
    after: "展开后的 JSON",
    tryExample: "试用这个示例",
    formattingTitle: "不止是 JSON 格式化",
    formattingDescription:
      "格式化调整缩进；Unquote 还会递归解析字符串中的 JSON，让嵌套对象和数组可以在树状视图中展开查看。",
    jsonlTitle: "逐行查看 JSONL，定位错误行",
    jsonlDescription:
      "JSONL 的每一行是一条独立记录。某一行解析失败时，其他有效记录仍可查看；打开失败记录即可检查解析错误和原始行。",
    localTitle: "数据在浏览器本地处理",
    localDescription:
      "粘贴的文本和导入的文件都在本地解析，无需上传内容。识别出的 Codex 和 Claude Code JSONL 会话还提供 Agent 与 Trajectory 视图。",
    enableJavaScript: "启用 JavaScript 后，即可粘贴 JSON、打开本地文件并使用交互式查看器。",
  },
  ja: {
    exampleTitle: "エスケープされた文字列を構造化データに",
    exampleDescription:
      "body フィールドは JSON 文字列です。Unquote はこれをオブジェクトに展開し、閲覧・検索・エクスポートできるようにします。",
    before: "元の JSON",
    after: "展開後の JSON",
    tryExample: "このサンプルを試す",
    formattingTitle: "JSON の整形だけではありません",
    formattingDescription:
      "整形はインデントを揃えます。Unquote は文字列内の JSON も再帰的に解析し、入れ子のオブジェクトや配列をツリーで表示します。",
    jsonlTitle: "無効な行を含む JSONL も確認",
    jsonlDescription:
      "JSONL の各行は独立したレコードです。一部の行で解析に失敗しても、有効なレコードは閲覧できます。失敗したレコードでエラーと元の行を確認できます。",
    localTitle: "データはブラウザー内で処理",
    localDescription:
      "貼り付けたテキストとファイルは内容をアップロードせず、ローカルで解析します。認識された Codex と Claude Code の JSONL セッションには Agent と Trajectory ビューもあります。",
    enableJavaScript:
      "JavaScript を有効にすると、JSON の貼り付け、ローカルファイルの読み込み、ビューアーの操作ができます。",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type WelcomeCopy = { [K in keyof typeof welcomeCopy.en]: string };
