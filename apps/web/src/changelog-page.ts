import type { Locale } from "@unquote/ui";
import { changelogLocales, changelogPaths } from "./changelog-routes.ts";

const SITE_ORIGIN = "https://unquote.xingkaixin.me";

interface ReleaseCopy {
  version: string;
  date: string;
  dateLabel: string;
  title: string;
  summary: string;
  highlights: readonly string[];
}

interface ChangelogCopy {
  title: string;
  description: string;
  socialDescription: string;
  socialImageAlt: string;
  blogName: string;
  blogDescription: string;
  skipLink: string;
  homeLabel: string;
  primaryNavigationLabel: string;
  latestNavigation: string;
  openUnquote: string;
  kicker: string;
  heading: string;
  heroSummary: string;
  directionHeading: string;
  directionSummary: string;
  priorities: readonly { title: string; description: string }[];
  latestHeading: string;
  latestSummary: string;
  versionPrefix: string;
  releases: readonly ReleaseCopy[];
  localProcessing: string;
  languageNavigationLabel: string;
  sourceLink: string;
}

const changelogCopy = {
  en: {
    title: "Unquote Product Updates | JSONL Viewer Changelog",
    description:
      "Read Unquote product updates for the local JSONL viewer, including large-file performance, Agent session analysis, nested JSON expansion, reliability, and privacy.",
    socialDescription:
      "See what changed in Unquote and how the local JSONL viewer is becoming faster, clearer, and more reliable.",
    socialImageAlt: "Unquote product logo social preview",
    blogName: "Unquote Product Updates",
    blogDescription: "User-focused release notes for Unquote, a local JSON and JSONL viewer.",
    skipLink: "Skip to product updates",
    homeLabel: "Unquote home",
    primaryNavigationLabel: "Primary navigation",
    latestNavigation: "Latest releases",
    openUnquote: "Open Unquote",
    kicker: "Product updates",
    heading: "What is changing in Unquote",
    heroSummary:
      "See what changed in Unquote and how the local JSONL viewer is becoming faster, clearer, more reliable, and privacy-first.",
    directionHeading: "Where the product is heading",
    directionSummary:
      "Unquote expands stringified JSON and turns supported Agent logs into readable sessions without sending imported content to a server. Recent releases focus on maintaining responsiveness as JSONL files grow, explaining Agent activity more clearly, and protecting the exact data users inspect, copy, and export.",
    priorities: [
      {
        title: "Large files, responsive tools",
        description:
          "Opening, searching, inspecting, and exporting JSONL should stay usable as files grow.",
      },
      {
        title: "Agent logs that tell a story",
        description:
          "Timelines and trajectories should explain what happened, when, and why it matters.",
      },
      {
        title: "Correct output before convenient output",
        description:
          "Exact numbers, complete records, and explicit limits protect the data being debugged.",
      },
      {
        title: "Local processing by default",
        description:
          "Imported content stays in the browser while the product gains better local analysis.",
      },
    ],
    latestHeading: "Latest releases",
    latestSummary:
      "Release notes written around the change a user can see, not the implementation behind it.",
    versionPrefix: "Version",
    releases: [
      {
        version: "1.2.2",
        date: "2026-09-05",
        dateLabel: "September 5, 2026",
        title: "Safer export limits, faster agent starts, and unified icons",
        summary:
          "Heavy exports now protect memory limits with clear feedback, Agent sessions reach their first view with less duplicate parsing, and icons are unified across the interface.",
        highlights: [
          "Buffered exports and unhydrated copy actions enforce explicit memory limits instead of freezing the tab.",
          "Initial Agent session inputs parse once during load, making long logs faster to open.",
          "Icons across the app are migrated to Phosphor Icons, and the import panel gains theme-aware backgrounds.",
        ],
      },
      {
        version: "1.2.1",
        date: "2026-08-31",
        dateLabel: "August 31, 2026",
        title: "Large JSONL stays responsive from open to export",
        summary:
          "Heavy local files now use less memory and keep the interface responsive from first open through final export, while stricter data checks reduce the chance of incomplete results.",
        highlights: [
          "Opening and inspecting large local JSONL files no longer ties up the interface with parsing work.",
          "Large exports are produced incrementally, lowering memory spikes and keeping the page usable.",
          "Exact numbers, full-source path queries, stable search navigation, and stricter output checks reduce silent data mistakes.",
        ],
      },
      {
        version: "1.2.0",
        date: "2026-08-24",
        dateLabel: "August 24, 2026",
        title: "Nested JSON expands all the way through",
        summary:
          "Consecutive layers of stringified JSON now open recursively, and Agent sessions reach a useful first view sooner with clearer failure details.",
        highlights: [
          "Objects, arrays, primitives, and strings nested across multiple escaped layers expand consistently.",
          "Japanese is available across the web app and browser experiences.",
          "Switching sources cannot let unfinished work from the previous source replace the current workspace.",
        ],
      },
      {
        version: "1.1.0",
        date: "2026-08-16",
        dateLabel: "August 16, 2026",
        title: "See an Agent session as a trajectory, not just a log",
        summary:
          "The Trajectory view turns a long Agent session into timed work, connecting turns, tool activity, failures, token usage, and original records.",
        highlights: [
          "A time overview keeps active clusters readable by compressing long idle gaps.",
          "Range, kind, status, search, and failure filters narrow large sessions quickly.",
          "Detail views connect calls and results to bounded raw JSON and their full source records.",
        ],
      },
      {
        version: "1.0.1",
        date: "2026-08-13",
        dateLabel: "August 13, 2026",
        title: "Safer inspection for large and exact values",
        summary:
          "Unquote now preserves the exact source text of JSON numbers and states clearly when a preview, copy, or structure measurement is incomplete.",
        highlights: [
          "Large integers and high-precision decimals survive tree labels, search, copy, and export unchanged.",
          "Oversized previews and copies stop at explicit limits instead of freezing or failing silently.",
          "Long values remain scrollable, and partial structure facts are no longer presented as complete.",
        ],
      },
      {
        version: "1.0.0",
        date: "2026-08-07",
        dateLabel: "August 7, 2026",
        title: "A focused workspace for everyday JSONL debugging",
        summary:
          "The 1.0 release shaped Unquote around one direct workflow: import a source, find the relevant record, inspect the value, and export the result.",
        highlights: [
          "A dedicated import flow supports paste, drop, file selection, samples, and format detection.",
          "The record rail, selected tree, and node inspector keep navigation and detail visible together.",
          "Recognized Agent logs gain a dedicated session view while the original JSONL remains available.",
        ],
      },
    ],
    localProcessing: "Unquote processes JSON and JSONL locally in your browser.",
    languageNavigationLabel: "Language",
    sourceLink: "View source on GitHub",
  },
  "zh-CN": {
    title: "Unquote 产品更新 | JSONL 查看器更新日志",
    description:
      "查看 Unquote 产品更新，了解本地 JSONL 查看器在大文件性能、Agent 会话分析、嵌套 JSON 展开、可靠性与隐私方面的改进。",
    socialDescription:
      "了解 Unquote 更新了什么，以及这款本地 JSONL 查看器如何变得更快、更清晰、更可靠。",
    socialImageAlt: "Unquote 产品标志社交分享预览",
    blogName: "Unquote 产品更新",
    blogDescription: "面向用户的 Unquote 更新说明。Unquote 是一款本地 JSON 和 JSONL 查看器。",
    skipLink: "跳到产品更新",
    homeLabel: "Unquote 首页",
    primaryNavigationLabel: "主要导航",
    latestNavigation: "最新版本",
    openUnquote: "打开 Unquote",
    kicker: "产品更新",
    heading: "Unquote 正在发生什么变化",
    heroSummary:
      "了解每个版本带来的变化，以及 Unquote 如何让本地 JSONL 查看更快、更清晰、更可靠，并坚持隐私优先。",
    directionHeading: "产品正在走向哪里",
    directionSummary:
      "Unquote 会展开字符串化 JSON，并在不把导入内容发送到服务器的前提下，将支持的 Agent 日志整理成可阅读的会话。近期版本持续关注大规模 JSONL 的响应速度、Agent 活动的解释能力，以及用户查看、复制和导出数据时的准确性。",
    priorities: [
      {
        title: "大文件也要保持流畅",
        description: "随着文件增大，打开、搜索、检查和导出 JSONL 仍应保持可用。",
      },
      {
        title: "让 Agent 日志讲清过程",
        description: "时间线和轨迹需要说明发生了什么、何时发生，以及为什么重要。",
      },
      {
        title: "先保证正确，再追求方便",
        description: "精确数字、完整记录和明确限制共同保护正在调试的数据。",
      },
      {
        title: "默认在本地处理",
        description: "导入内容留在浏览器中，同时获得更完善的本地分析能力。",
      },
    ],
    latestHeading: "最新版本",
    latestSummary: "更新说明只关注用户可以感知的变化，不罗列背后的实现细节。",
    versionPrefix: "版本",
    releases: [
      {
        version: "1.2.2",
        date: "2026-09-05",
        dateLabel: "2026 年 9 月 5 日",
        title: "更安全的导出上限、更快的 Agent 启动与统一的图标",
        summary:
          "大文件导出增加内存保护与清晰反馈，Agent 会话减少重复解析加快首屏呈现，全界面图标统一规范。",
        highlights: [
          "缓冲导出与未水合记录复制增加显式内存上限，避免大体积操作卡死标签页。",
          "Agent 会话初始输入改为仅解析一次，加快大日志的打开速度与首屏渲染。",
          "界面图标统一迁移至 Phosphor 图标库，导入面板新增适配明暗主题的背景装饰。",
        ],
      },
      {
        version: "1.2.1",
        date: "2026-08-31",
        dateLabel: "2026 年 8 月 31 日",
        title: "从打开到导出，大型 JSONL 都能保持流畅",
        summary:
          "大型本地文件现在占用更少内存，从首次打开到最终导出都能保持界面响应；更严格的数据检查也减少了产生不完整结果的可能。",
        highlights: [
          "打开和检查大型本地 JSONL 时，解析工作不再长时间占用界面。",
          "大型导出改为渐进生成，减少内存峰值并保持页面可用。",
          "精确数字、完整来源路径查询、稳定的搜索导航和更严格的输出检查，可以减少不易察觉的数据错误。",
        ],
      },
      {
        version: "1.2.0",
        date: "2026-08-24",
        dateLabel: "2026 年 8 月 24 日",
        title: "多层嵌套 JSON 现在可以一直展开到底",
        summary:
          "连续多层的字符串化 JSON 现在会递归展开，Agent 会话也能更快进入可用视图，并提供更清晰的失败信息。",
        highlights: [
          "跨越多层转义内容的对象、数组、基础值和字符串都能一致展开。",
          "网页应用和浏览器体验现在都提供日文。",
          "切换来源后，前一个来源尚未完成的任务不会再覆盖当前工作区。",
        ],
      },
      {
        version: "1.1.0",
        date: "2026-08-16",
        dateLabel: "2026 年 8 月 16 日",
        title: "用轨迹理解 Agent 会话，而不只是阅读日志",
        summary:
          "轨迹视图把长时间的 Agent 会话整理成按时间展开的工作过程，串联轮次、工具活动、失败、令牌用量和原始记录。",
        highlights: [
          "时间概览会压缩长时间空闲区间，让活跃片段保持清晰。",
          "通过时间范围、类型、状态、搜索和失败条件，可以快速缩小大型会话范围。",
          "详情视图把调用和结果关联到有限范围的原始 JSON 及其完整来源记录。",
        ],
      },
      {
        version: "1.0.1",
        date: "2026-08-13",
        dateLabel: "2026 年 8 月 13 日",
        title: "更安全地检查大型值和精确数值",
        summary:
          "Unquote 现在会保留 JSON 数字的准确源文本，并明确说明预览、复制或结构统计何时是不完整的。",
        highlights: [
          "大整数和高精度小数经过树标签、搜索、复制和导出后仍保持原样。",
          "超大预览和复制会在明确限制处停止，避免页面卡死或无提示失败。",
          "长内容仍可滚动查看，局部结构信息也不再被呈现为完整结果。",
        ],
      },
      {
        version: "1.0.0",
        date: "2026-08-07",
        dateLabel: "2026 年 8 月 7 日",
        title: "面向日常 JSONL 调试的专注工作区",
        summary:
          "1.0 版本围绕一条直接流程塑造 Unquote：导入来源、找到相关记录、检查值，然后导出结果。",
        highlights: [
          "专用导入流程支持粘贴、拖放、选择文件、示例和格式检测。",
          "记录栏、选中内容树和节点检查器让导航与详情同时可见。",
          "可识别的 Agent 日志会获得专用会话视图，同时仍可查看原始 JSONL。",
        ],
      },
    ],
    localProcessing: "Unquote 只在浏览器本地处理 JSON 和 JSONL。",
    languageNavigationLabel: "语言",
    sourceLink: "在 GitHub 查看源代码",
  },
  ja: {
    title: "Unquote 製品アップデート | JSONL ビューアー更新履歴",
    description:
      "Unquote の製品アップデートを確認し、ローカル JSONL ビューアーの大規模ファイル性能、Agent セッション分析、ネスト JSON 展開、信頼性、プライバシーに関する改善をご覧ください。",
    socialDescription:
      "Unquote の変更点と、ローカル JSONL ビューアーをより速く、分かりやすく、信頼できるものにする取り組みをご覧ください。",
    socialImageAlt: "Unquote 製品ロゴのソーシャルプレビュー",
    blogName: "Unquote 製品アップデート",
    blogDescription:
      "ローカル JSON および JSONL ビューアー Unquote の、ユーザー向けリリースノートです。",
    skipLink: "製品アップデートへ移動",
    homeLabel: "Unquote ホーム",
    primaryNavigationLabel: "メインナビゲーション",
    latestNavigation: "最新リリース",
    openUnquote: "Unquote を開く",
    kicker: "製品アップデート",
    heading: "Unquote はどう変わっているか",
    heroSummary:
      "各リリースの変更点と、Unquote がローカル JSONL の閲覧をより速く、分かりやすく、信頼できるものにしながら、プライバシーを優先する取り組みをご覧ください。",
    directionHeading: "プロダクトが目指す方向",
    directionSummary:
      "Unquote は文字列化された JSON を展開し、インポートした内容をサーバーへ送ることなく、対応する Agent ログを読みやすいセッションに整理します。最近のリリースでは、大規模な JSONL でも応答性を保つこと、Agent の動きを明確に説明すること、表示、コピー、エクスポートするデータの正確さを守ることに注力しています。",
    priorities: [
      {
        title: "大きなファイルでも軽快に",
        description:
          "ファイルが大きくなっても、JSONL のオープン、検索、確認、エクスポートを快適に使えることを目指します。",
      },
      {
        title: "Agent ログから流れを読み取る",
        description:
          "タイムラインと軌跡から、何が、いつ起き、なぜ重要なのかを理解できるようにします。",
      },
      {
        title: "利便性より先に正確さを",
        description:
          "正確な数値、完全なレコード、明示的な制限によって、デバッグ中のデータを守ります。",
      },
      {
        title: "ローカル処理を標準に",
        description: "インポートした内容をブラウザ内に保ちながら、ローカル分析を充実させます。",
      },
    ],
    latestHeading: "最新リリース",
    latestSummary: "実装の詳細ではなく、ユーザーが実感できる変化を中心にまとめています。",
    versionPrefix: "バージョン",
    releases: [
      {
        version: "1.2.2",
        date: "2026-09-05",
        dateLabel: "2026年9月5日",
        title: "より安全なエクスポート上限、Agent 起動の高速化、アイコンの統一",
        summary:
          "大きなエクスポートにメモリ保護と明確なフィードバックを追加し、Agent セッションの重複解析を削減して初期表示を高速化し、UI 全体のアイコンを統一しました。",
        highlights: [
          "バッファ付きエクスポートと未ハイドレーション行のコピーに明示的なメモリ制限を設け、タブのフリーズを防ぎます。",
          "Agent セッションの初期入力を1回のみ解析するように改善し、大きなログの初回表示を高速化しました。",
          "アプリ全体のアイコンを Phosphor Icons に移行し、インポート画面にテーマ連動の背景を追加しました。",
        ],
      },
      {
        version: "1.2.1",
        date: "2026-08-31",
        dateLabel: "2026年8月31日",
        title: "大規模 JSONL を開いてからエクスポートするまで軽快に",
        summary:
          "大きなローカルファイルのメモリ使用量を抑え、最初に開くところから最終エクスポートまで画面の応答性を維持します。より厳密なデータ検査により、不完全な結果が生じる可能性も減りました。",
        highlights: [
          "大きなローカル JSONL を開いて確認するとき、解析処理が画面を長時間占有しなくなりました。",
          "大規模なエクスポートを段階的に生成し、メモリ使用量の急増を抑えながらページを操作できます。",
          "正確な数値、ソース全体のパス検索、安定した検索移動、厳密な出力検査により、気づきにくいデータの誤りを減らします。",
        ],
      },
      {
        version: "1.2.0",
        date: "2026-08-24",
        dateLabel: "2026年8月24日",
        title: "ネストした JSON を最後の階層まで展開",
        summary:
          "連続する複数階層の文字列化 JSON を再帰的に展開できるようになりました。Agent セッションはより早く使える表示に到達し、失敗の詳細も明確に示します。",
        highlights: [
          "複数のエスケープ階層に含まれるオブジェクト、配列、プリミティブ、文字列を一貫して展開します。",
          "Web アプリとブラウザ向けの画面で日本語を利用できます。",
          "ソースを切り替えた後、前のソースで未完了の処理が現在のワークスペースを置き換えることはありません。",
        ],
      },
      {
        version: "1.1.0",
        date: "2026-08-16",
        dateLabel: "2026年8月16日",
        title: "Agent セッションを単なるログではなく軌跡として把握",
        summary:
          "軌跡ビューは長い Agent セッションを時間に沿った作業として整理し、ターン、ツール活動、失敗、トークン使用量、元のレコードを結び付けます。",
        highlights: [
          "長い待機時間を圧縮する時間概要により、活動が集中する区間を読みやすく保ちます。",
          "時間範囲、種類、状態、検索、失敗の条件で、大きなセッションをすばやく絞り込めます。",
          "詳細ビューから、呼び出しと結果に対応する範囲を限定した生の JSON と完全なソースレコードを確認できます。",
        ],
      },
      {
        version: "1.0.1",
        date: "2026-08-13",
        dateLabel: "2026年8月13日",
        title: "大きな値と正確な数値をより安全に確認",
        summary:
          "Unquote は JSON 数値の正確なソーステキストを保持し、プレビュー、コピー、構造の計測が不完全な場合は明確に示すようになりました。",
        highlights: [
          "大きな整数と高精度の小数は、ツリー表示、検索、コピー、エクスポートを経ても変化しません。",
          "非常に大きなプレビューやコピーは明示された上限で停止し、画面の停止や無言の失敗を防ぎます。",
          "長い値は引き続きスクロールでき、部分的な構造情報を完全な結果として表示しません。",
        ],
      },
      {
        version: "1.0.0",
        date: "2026-08-07",
        dateLabel: "2026年8月7日",
        title: "日常の JSONL デバッグに集中できるワークスペース",
        summary:
          "1.0 では、ソースをインポートし、関連するレコードを探し、値を確認して、結果をエクスポートするという一連の流れを中心に Unquote を設計しました。",
        highlights: [
          "専用のインポート画面は、貼り付け、ドロップ、ファイル選択、サンプル、形式の検出に対応します。",
          "レコード一覧、選択中のツリー、ノードインスペクターにより、移動と詳細を同時に確認できます。",
          "認識された Agent ログには専用のセッション表示が加わり、元の JSONL も引き続き確認できます。",
        ],
      },
    ],
    localProcessing: "Unquote は JSON と JSONL をブラウザ内でローカル処理します。",
    languageNavigationLabel: "言語",
    sourceLink: "GitHub でソースを見る",
  },
} satisfies Record<Locale, ChangelogCopy>;

const localeMetadata = {
  en: { ogLocale: "en_US", languageLabel: "English" },
  "zh-CN": { ogLocale: "zh_CN", languageLabel: "简体中文" },
  ja: { ogLocale: "ja_JP", languageLabel: "日本語" },
} as const satisfies Record<Locale, { ogLocale: string; languageLabel: string }>;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

const absoluteUrl = (path: string) => `${SITE_ORIGIN}${path}`;

const releaseId = (version: string) => `v${version.replaceAll(".", "-")}`;

const renderAlternateLinks = () =>
  [
    ...changelogLocales.map(
      (locale) =>
        `<link rel="alternate" hreflang="${locale}" href="${absoluteUrl(changelogPaths[locale])}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(changelogPaths.en)}" />`,
  ].join("\n    ");

const renderOgLocaleAlternates = (locale: Locale) =>
  changelogLocales
    .filter((candidate) => candidate !== locale)
    .map(
      (candidate) =>
        `<meta property="og:locale:alternate" content="${localeMetadata[candidate].ogLocale}" />`,
    )
    .join("\n    ");

const renderSchema = (locale: Locale, copy: ChangelogCopy, canonicalUrl: string) =>
  JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${SITE_ORIGIN}/#organization`,
          name: "Unquote",
          url: `${SITE_ORIGIN}/`,
          logo: { "@type": "ImageObject", url: `${SITE_ORIGIN}/og-image.png` },
          sameAs: ["https://github.com/xingkaixin/unquote"],
        },
        {
          "@type": "Blog",
          "@id": `${canonicalUrl}#changelog`,
          name: copy.blogName,
          description: copy.blogDescription,
          url: canonicalUrl,
          inLanguage: locale,
          publisher: { "@id": `${SITE_ORIGIN}/#organization` },
          blogPost: copy.releases.map((release) => ({
            "@type": "BlogPosting",
            headline: release.title,
            description: release.summary,
            datePublished: release.date,
            dateModified: release.date,
            inLanguage: locale,
            url: `${canonicalUrl}#${releaseId(release.version)}`,
            author: { "@id": `${SITE_ORIGIN}/#organization` },
            publisher: { "@id": `${SITE_ORIGIN}/#organization` },
          })),
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Unquote",
              item: `${SITE_ORIGIN}/`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: copy.kicker,
              item: canonicalUrl,
            },
          ],
        },
      ],
    },
    null,
    2,
  ).replaceAll("<", "\\u003c");

const renderPriorities = (copy: ChangelogCopy) =>
  copy.priorities
    .map(
      (priority) => `<div>
            <dt>${escapeHtml(priority.title)}</dt>
            <dd>${escapeHtml(priority.description)}</dd>
          </div>`,
    )
    .join("\n          ");

const renderReleases = (copy: ChangelogCopy) =>
  copy.releases
    .map(
      (release) => `<article class="release" id="${releaseId(release.version)}">
          <div class="release-meta">
            <p>${escapeHtml(copy.versionPrefix)} ${escapeHtml(release.version)}</p>
            <time datetime="${release.date}">${escapeHtml(release.dateLabel)}</time>
          </div>
          <div class="release-content">
            <h3>${escapeHtml(release.title)}</h3>
            <p class="release-summary">${escapeHtml(release.summary)}</p>
            <ul>
              ${release.highlights.map((highlight) => `<li>${escapeHtml(highlight)}</li>`).join("\n              ")}
            </ul>
          </div>
        </article>`,
    )
    .join("\n\n        ");

const renderLanguageLinks = (locale: Locale, label: string) =>
  `<nav class="language-links" aria-label="${escapeHtml(label)}">
          ${changelogLocales
            .map(
              (candidate) =>
                `<a href="${changelogPaths[candidate]}" lang="${candidate}" hreflang="${candidate}"${candidate === locale ? ' aria-current="page"' : ""}>${localeMetadata[candidate].languageLabel}</a>`,
            )
            .join("\n          ")}
        </nav>`;

export const renderChangelogPage = (locale: Locale) => {
  const copy = changelogCopy[locale];
  const canonicalUrl = absoluteUrl(changelogPaths[locale]);

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(copy.description)}" />
    <meta name="robots" content="index, follow" />
    <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
    <meta name="application-name" content="Unquote" />
    <meta name="theme-color" content="#f4f5f6" />
    <meta name="color-scheme" content="light dark" />
    <link rel="canonical" href="${canonicalUrl}" />
    ${renderAlternateLinks()}
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/src/changelog.css" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:site_name" content="Unquote" />
    <meta property="og:title" content="${escapeHtml(copy.title)}" />
    <meta property="og:description" content="${escapeHtml(copy.socialDescription)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta property="og:image:alt" content="${escapeHtml(copy.socialImageAlt)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="${localeMetadata[locale].ogLocale}" />
    ${renderOgLocaleAlternates(locale)}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(copy.title)}" />
    <meta name="twitter:description" content="${escapeHtml(copy.socialDescription)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:image:alt" content="${escapeHtml(copy.socialImageAlt)}" />
    <title>${escapeHtml(copy.title)}</title>
    <script type="application/ld+json">${renderSchema(locale, copy, canonicalUrl)}</script>
  </head>
  <body>
    <a class="skip-link" href="#main-content">${escapeHtml(copy.skipLink)}</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/" aria-label="${escapeHtml(copy.homeLabel)}">
          <img src="/favicon.svg" width="26" height="26" alt="" />
          <span>UNQUOTE</span>
        </a>
        <nav aria-label="${escapeHtml(copy.primaryNavigationLabel)}">
          <a class="nav-link" href="#latest">${escapeHtml(copy.latestNavigation)}</a>
          <a class="primary-link" href="/">${escapeHtml(copy.openUnquote)}</a>
        </nav>
      </div>
    </header>

    <main id="main-content">
      <section class="hero" aria-labelledby="page-title">
        <p class="kicker">${escapeHtml(copy.kicker)}</p>
        <h1 id="page-title">${escapeHtml(copy.heading)}</h1>
        <p class="hero-summary">${escapeHtml(copy.heroSummary)}</p>
      </section>

      <section class="direction" aria-labelledby="direction-title">
        <div class="section-intro">
          <h2 id="direction-title">${escapeHtml(copy.directionHeading)}</h2>
          <p>${escapeHtml(copy.directionSummary)}</p>
        </div>
        <dl class="direction-list">
          ${renderPriorities(copy)}
        </dl>
      </section>

      <section class="releases" id="latest" aria-labelledby="latest-title">
        <div class="section-intro release-intro">
          <h2 id="latest-title">${escapeHtml(copy.latestHeading)}</h2>
          <p>${escapeHtml(copy.latestSummary)}</p>
        </div>

        ${renderReleases(copy)}
      </section>
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        <p>${escapeHtml(copy.localProcessing)}</p>
        <div class="footer-links">
          ${renderLanguageLinks(locale, copy.languageNavigationLabel)}
          <a href="https://github.com/xingkaixin/unquote">${escapeHtml(copy.sourceLink)}</a>
        </div>
      </div>
    </footer>
  </body>
</html>`;
};
