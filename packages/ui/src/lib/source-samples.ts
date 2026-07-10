export const sourceSamples = {
  escapedApiResponse: {
    source: JSON.stringify(
      {
        status: 200,
        requestId: "req_7f32",
        body: JSON.stringify({
          user: { id: "u_42", plan: "pro" },
          items: [
            { sku: "jsonl-debug", quantity: 2 },
            { sku: "extension-seat", quantity: 1 },
          ],
          flags: { cached: false, beta: true },
        }),
      },
      null,
      2,
    ),
    expandedPathsByRecord: [{ recordId: "record-1", paths: ["$.body"] }],
  },
  agentToolCallJsonl: {
    source: [
      JSON.stringify({
        ts: "2026-05-15T10:02:11Z",
        event: "message",
        role: "user",
        content: "Find open invoices for customer cus_42.",
      }),
      JSON.stringify({
        ts: "2026-05-15T10:02:12Z",
        event: "tool_call",
        tool: "billing.search",
        action: "query",
        args: JSON.stringify({
          customerId: "cus_42",
          status: ["open", "past_due"],
          limit: 3,
        }),
      }),
      JSON.stringify({
        ts: "2026-05-15T10:02:13Z",
        event: "tool_result",
        tool: "billing.search",
        ok: true,
        result: JSON.stringify({
          invoices: [{ id: "inv_1007", total: 12900, currency: "USD" }],
        }),
      }),
    ].join("\n"),
    expandedPathsByRecord: [
      { recordId: "record-2", paths: ["$.args"] },
      { recordId: "record-3", paths: ["$.result"] },
    ],
  },
  codexRolloutJsonl: {
    source: [
      JSON.stringify({
        timestamp: "2026-06-06T13:44:06.579Z",
        type: "session_meta",
        payload: {
          session_id: "019e9d2d-3639-75b2-b26e-be6650102fea",
          cwd: "/Users/example/project",
          cli_version: "0.137.0",
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-06T13:44:06.581Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-06T13:44:07.964Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Find the files that mention billing.search." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-06T13:44:08.824Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "Search the workspace before editing." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-06T13:44:09.027Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: 'rg "billing.search"' }),
          call_id: "call_demo",
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-06T13:44:09.300Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_demo",
          output: "packages/billing/search.ts\n",
        },
      }),
    ].join("\n"),
    expandedPathsByRecord: [{ recordId: "record-5", paths: ["$.payload.arguments"] }],
  },
  mixedValidInvalidJsonl: {
    source: [
      JSON.stringify({
        event: "webhook.received",
        action: "enqueue",
        payload: JSON.stringify({ id: "evt_001", type: "checkout.completed" }),
      }),
      '{"event":"tool_result","tool":"billing.fetch","result":{"ok":true}',
      JSON.stringify({
        event: "worker.retry",
        action: "retry",
        attempt: 2,
        payload: { id: "evt_001", reason: "parse_error" },
      }),
    ].join("\n"),
    expandedPathsByRecord: [{ recordId: "record-1", paths: ["$.payload"] }],
  },
} as const;
