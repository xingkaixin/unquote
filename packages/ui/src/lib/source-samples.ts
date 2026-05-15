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
    expandedPaths: ["$.body"],
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
    expandedPaths: ["$.args", "$.result"],
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
    expandedPaths: ["$.payload"],
  },
} as const;
