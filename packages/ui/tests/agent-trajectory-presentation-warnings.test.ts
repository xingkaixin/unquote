import { describe, expect, it } from "vitest";
import type { AgentCanonicalSelection } from "../src/lib/agent-session/types";
import {
  createAgentTrajectoryModel,
  type AgentSession,
  type AgentTrajectoryWarning,
} from "../src/lib/agent-session";
import {
  agentTrajectoryWarningKinds,
  createAgentTrajectoryPresentation,
} from "../src/lib/agent-session/trajectory-presentation";
import {
  selectionFor,
  eventFor,
  toolItemFor,
  turnFor,
  modelFor,
  warningGroupsFor,
  warningForKind,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: warnings", () => {
  it("attaches a warning without a call id only to its unique canonical candidate", () => {
    const selection = selectionFor("unique-no-call");
    const item = toolItemFor("unique-no-call-tool", "running", { callSelection: selection });
    const warning = {
      kind: "unpaired-tool-call",
      recordId: selection.recordId,
      lineNumber: 8,
      selection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(modelFor([], [item], [], [warning]));

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor([warning]));
    expect(presentation.unattachedWarningGroups).toEqual([]);
  });

  it("attaches a warning with an exact call id without crossing shared canonical candidates", () => {
    const callSelection = selectionFor("call-evidence");
    const first = toolItemFor("tool-one", "running", {
      callId: "call-one",
      callSelection,
    });
    const second = toolItemFor("tool-two", "running", {
      callId: "call-two",
      callSelection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "call-one",
      recordId: "record-call-evidence",
      lineNumber: 7,
      selection: callSelection,
    } satisfies AgentTrajectoryWarning;
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("tool-one", "First tool", ""),
          eventFor("tool-two", "Second tool", ""),
          eventFor("call-evidence", "Call evidence", ""),
        ],
        [first, second],
        [],
        [warning],
      ),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      warningGroupsFor([warning]),
      [],
    ]);
  });

  it("matches same-selection warning call ids without rescanning every tool", () => {
    const itemCount = 32;
    const sharedCallSelection = selectionFor("shared-call-evidence");
    let callIdReads = 0;
    const items = Array.from({ length: itemCount }, (_, index) => {
      const item = toolItemFor(`tool-candidate-${index}`, "running", {
        callId: `call-${index}`,
        callSelection: sharedCallSelection,
      });
      Object.defineProperty(item, "callId", {
        configurable: true,
        enumerable: true,
        get() {
          callIdReads += 1;
          return `call-${index}`;
        },
      });
      return item;
    });
    const warnings: AgentTrajectoryWarning[] = items.map((item, index) => ({
      kind: "unpaired-tool-call",
      callId: `call-${index}`,
      recordId: sharedCallSelection.recordId,
      lineNumber: item.lineNumber,
      selection: sharedCallSelection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], items, [], warnings));

    expect(presentation.items.map((item) => item.warningGroups)).toEqual(
      warnings.map((warning) => [{ warning, count: 1 }]),
    );
    expect(callIdReads).toBeLessThanOrEqual(itemCount * 2);
  });

  it("keeps duplicate canonical selection and call id candidates unattached", () => {
    const selection = selectionFor("duplicate-call");
    const first = toolItemFor("duplicate-first", "running", {
      callId: "call-duplicate",
      callSelection: selection,
    });
    const second = toolItemFor("duplicate-second", "running", {
      callId: "call-duplicate",
      callSelection: selection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "call-duplicate",
      recordId: selection.recordId,
      lineNumber: 10,
      selection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [first, second], [], [warning]),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([[], []]);
    expect(presentation.unattachedWarningGroups).toEqual(warningGroupsFor([warning]));
  });

  it("keeps 5,005 ambiguous no-call warnings unattached and bounded", () => {
    const count = 5_005;
    const sharedSelection = selectionFor("broadcast-evidence");
    const items = Array.from({ length: count }, (_, index) =>
      toolItemFor(`broadcast-${index}`, "running", { callSelection: sharedSelection }),
    );
    const warnings: AgentTrajectoryWarning[] = Array.from({ length: count }, (_, index) => ({
      kind: "unpaired-tool-call",
      recordId: sharedSelection.recordId,
      lineNumber: index + 1,
      selection: sharedSelection,
    }));

    const source = modelFor([], items, [], warnings);
    const beforeProjection = JSON.stringify(source.trajectory);
    Object.freeze(sharedSelection);
    for (const item of items) {
      Object.freeze(item);
    }
    Object.freeze(items);
    for (const warning of warnings) {
      Object.freeze(warning);
    }
    Object.freeze(warnings);

    const presentation = createAgentTrajectoryPresentation(source);

    expect(presentation.items.every((item) => item.warningGroups.length === 0)).toBe(true);
    expect(presentation.unattachedWarningGroups).toEqual([{ warning: warnings[0], count }]);
    expect(presentation.summary.warningCount).toBe(count);
    expect(presentation.items[0]).not.toHaveProperty("warnings");
    expect(JSON.stringify(source.trajectory)).toBe(beforeProjection);
  });

  it("groups 5,005 uniquely attached warnings by kind", () => {
    const count = 5_005;
    const selection = selectionFor("grouped-attached");
    const item = toolItemFor("grouped-attached-tool", "running", { callSelection: selection });
    const warnings: AgentTrajectoryWarning[] = Array.from({ length: count }, (_, index) => ({
      kind: "unpaired-tool-call",
      recordId: selection.recordId,
      lineNumber: index + 1,
      selection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], [item], [], warnings));

    expect(presentation.items[0]?.warningGroups).toEqual([{ warning: warnings[0], count }]);
    expect(presentation.unattachedWarningGroups).toEqual([]);
    expect(presentation.summary.warningCount).toBe(count);
  });

  it("keeps opaque warning call ids exact, including whitespace", () => {
    const sharedCallSelection = selectionFor("opaque-call-evidence");
    const paddedCall = toolItemFor("opaque-padded", "running", {
      callId: " call-1 ",
      callSelection: sharedCallSelection,
    });
    const blankCall = toolItemFor("opaque-blank", "running", {
      callId: " ",
      callSelection: sharedCallSelection,
    });
    const warnings: AgentTrajectoryWarning[] = [
      {
        kind: "unpaired-tool-call",
        callId: " call-1 ",
        recordId: sharedCallSelection.recordId,
        lineNumber: paddedCall.lineNumber,
        selection: sharedCallSelection,
      },
      {
        kind: "unpaired-tool-call",
        callId: " ",
        recordId: sharedCallSelection.recordId,
        lineNumber: blankCall.lineNumber,
        selection: sharedCallSelection,
      },
    ];

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [paddedCall, blankCall], [], warnings),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      warningGroupsFor([warnings[0]!]),
      warningGroupsFor([warnings[1]!]),
    ]);
  });

  it("keeps delimiter-containing canonical selections isolated for one call id", () => {
    const firstSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record\u0000fragment",
      id: "tail",
    };
    const secondSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record",
      id: "fragment\u0000tail",
    };
    const first = toolItemFor("nul-first", "running", {
      callId: "shared-call",
      callSelection: firstSelection,
    });
    const second = toolItemFor("nul-second", "running", {
      callId: "shared-call",
      callSelection: secondSelection,
    });
    const warning = {
      kind: "unpaired-tool-call",
      callId: "shared-call",
      recordId: secondSelection.recordId,
      lineNumber: 91,
      selection: secondSelection,
    } satisfies AgentTrajectoryWarning;

    const presentation = createAgentTrajectoryPresentation(
      modelFor([], [first, second], [], [warning]),
    );

    expect(presentation.items.map((item) => item.warningGroups)).toEqual([
      [],
      warningGroupsFor([warning]),
    ]);
  });

  it("keeps record, event, and conversation selections exact with quotes and NUL characters", () => {
    const selections: readonly AgentCanonicalSelection[] = [
      { kind: "record", recordId: 'record"\u0000id' },
      { kind: "event", recordId: 'event"\u0000record', id: 'event"\u0000id' },
      {
        kind: "conversation",
        recordId: 'conversation"\u0000record',
        id: 'conversation"\u0000id',
      },
    ];
    const callIds = ["call-record", "call-event", "call-conversation"] as const;
    const items = selections.map((selection, index) =>
      toolItemFor(`escaped-${index}`, "running", {
        callId: callIds[index]!,
        callSelection: selection,
      }),
    );
    const warnings: AgentTrajectoryWarning[] = selections.map((selection, index) => ({
      kind: "unpaired-tool-call",
      callId: callIds[index]!,
      recordId: selection.recordId,
      lineNumber: 100 + index,
      selection,
    }));

    const presentation = createAgentTrajectoryPresentation(modelFor([], items, [], warnings));

    expect(presentation.items.map((item) => item.warningGroups)).toEqual(
      warnings.map((warning) => [{ warning, count: 1 }]),
    );
  });

  it("uses call, result, and completion selections as warning candidates", () => {
    const call = selectionFor("call-evidence-2");
    const result = selectionFor("result-evidence-2");
    const completion = selectionFor("completion-evidence-2");
    const item = toolItemFor("tool-evidence-2", "failed", {
      callId: "call-evidence-2",
      callSelection: call,
      resultSelection: result,
      completionSelection: completion,
    });
    const warnings = [
      {
        kind: "unpaired-tool-call",
        callId: "call-evidence-2",
        recordId: call.recordId,
        lineNumber: 1,
        selection: call,
      } satisfies AgentTrajectoryWarning,
      {
        kind: "unpaired-tool-result",
        callId: "call-evidence-2",
        recordId: result.recordId,
        lineNumber: 2,
        selection: result,
      } satisfies AgentTrajectoryWarning,
      {
        kind: "unpaired-tool-completion",
        callId: "call-evidence-2",
        recordId: completion.recordId,
        lineNumber: 3,
        selection: completion,
      } satisfies AgentTrajectoryWarning,
    ];
    const presentation = createAgentTrajectoryPresentation(
      modelFor(
        [
          eventFor("tool-evidence-2", "Tool", ""),
          eventFor("call-evidence-2", "Call", ""),
          eventFor("result-evidence-2", "Result", ""),
          eventFor("completion-evidence-2", "Completion", ""),
        ],
        [item],
        [],
        warnings,
      ),
    );

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor(warnings));
  });

  it("groups every shared warning kind without attaching it to a different tool", () => {
    const sharedSelection = selectionFor("shared-warning-evidence");
    const tool = toolItemFor("grouped-warning-tool", "running", {
      callId: "call-attached",
      callSelection: sharedSelection,
    });
    const terminalSelection = selectionFor("terminal-warning-evidence");
    const attachedWarning = {
      kind: "unpaired-tool-call",
      callId: "call-attached",
      recordId: sharedSelection.recordId,
      lineNumber: 69,
      selection: sharedSelection,
    } satisfies AgentTrajectoryWarning;
    const unmatchedCallWarning = {
      kind: "unpaired-tool-call",
      callId: "call-unmatched",
      recordId: sharedSelection.recordId,
      lineNumber: 70,
      selection: sharedSelection,
    } satisfies AgentTrajectoryWarning;
    const warningsForEveryKind = agentTrajectoryWarningKinds.map((kind, index) =>
      kind === "unpaired-tool-call"
        ? unmatchedCallWarning
        : warningForKind(kind, 71 + index, terminalSelection),
    );
    const warnings: readonly AgentTrajectoryWarning[] = [
      attachedWarning,
      ...warningsForEveryKind,
      {
        kind: "unpaired-tool-call",
        callId: "call-unmatched-second",
        recordId: terminalSelection.recordId,
        lineNumber: 82,
        selection: terminalSelection,
      },
    ];
    const source = modelFor(
      [
        eventFor("grouped-warning-tool", "Tool", ""),
        eventFor("shared-warning-evidence", "Call", ""),
        eventFor("terminal-warning-evidence", "Terminal", ""),
      ],
      [tool],
      [turnFor("turn-1", [tool])],
      warnings,
    );
    const beforeProjection = JSON.stringify(source.trajectory);
    Object.freeze(tool);
    Object.freeze(source.trajectory.items);
    Object.freeze(source.trajectory.turns);
    for (const warning of warnings) {
      Object.freeze(warning);
    }
    Object.freeze(source.trajectory.warnings);

    const presentation = createAgentTrajectoryPresentation(source);

    expect(presentation.items[0]?.warningGroups).toEqual(warningGroupsFor([attachedWarning]));
    expect(Object.isFrozen(agentTrajectoryWarningKinds)).toBe(true);
    expect(presentation.unattachedWarningGroups).toHaveLength(agentTrajectoryWarningKinds.length);
    expect(presentation.unattachedWarningGroups.map((group) => group.warning.kind)).toEqual(
      agentTrajectoryWarningKinds,
    );
    expect(presentation.unattachedWarningGroups.map((group) => group.count)).toEqual(
      agentTrajectoryWarningKinds.map((kind) => (kind === "unpaired-tool-call" ? 2 : 1)),
    );
    expect(
      presentation.unattachedWarningGroups.find(
        (group) => group.warning.kind === "unpaired-tool-call",
      ),
    ).toEqual({
      warning: unmatchedCallWarning,
      count: 2,
    });
    expect(
      presentation.unattachedWarningGroups.find(
        (group) => group.warning.kind === "reversed-timestamp",
      )?.warning.selection,
    ).toBe(terminalSelection);
    expect(presentation.summary.warningCount).toBe(warnings.length);
    expect(JSON.stringify(source.trajectory)).toBe(beforeProjection);
  });

  it("keeps a reversed terminal lifecycle warning unattached to the preceding item", () => {
    const session = {
      fileType: "Codex",
      meta: { turnCount: 1 },
      parseWarnings: [],
      parseWarningCount: 0,
      events: [
        {
          ...eventFor("lifecycle-start", "Start", ""),
          timestamp: 20,
          sessionEvidence: [{ kind: "turn-lifecycle", phase: "start", turnId: "turn-1" }],
        },
        {
          ...eventFor("lifecycle-item", "Item", ""),
          timestamp: 30,
          sessionEvidence: [{ kind: "model-output", role: "assistant", turnId: "turn-1" }],
        },
        {
          ...eventFor("lifecycle-terminal", "Terminal", ""),
          timestamp: 10,
          sessionEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-1" }],
        },
      ],
    } satisfies AgentSession;
    const trajectory = createAgentTrajectoryModel(session);
    const presentation = createAgentTrajectoryPresentation(
      modelFor(session.events, trajectory.items, trajectory.turns, trajectory.warnings),
    );
    const reversedWarning = trajectory.warnings.find(
      (warning) => warning.kind === "reversed-timestamp" && warning.subject === "turn",
    );

    expect(reversedWarning).toBeDefined();
    expect(presentation.items).toHaveLength(1);
    expect(presentation.items[0]?.warningGroups).not.toContainEqual({
      warning: reversedWarning,
      count: 1,
    });
    expect(presentation.unattachedWarningGroups).toContainEqual({
      warning: reversedWarning,
      count: 1,
    });
  });
});
