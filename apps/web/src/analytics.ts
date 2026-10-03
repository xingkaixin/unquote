export const analyticsScript = `<script
  defer
  src="https://umami.xingkaixin.me/script.js"
  data-website-id="65b7d2aa-b029-43fc-8a87-a62ca0f3f23d"
  data-domains="unquote.xingkaixin.me"
  data-exclude-hash="true"
  data-performance="true"
></script>`;

export const addAnalytics = (html: string) => html.replace("</head>", `${analyticsScript}</head>`);
