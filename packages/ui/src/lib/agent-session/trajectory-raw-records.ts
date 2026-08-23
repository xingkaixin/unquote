import type { AgentTrajectoryItem } from "./trajectory-types";

export type AgentTrajectoryRawRecordRole = "record" | "call" | "result";

export interface AgentTrajectoryRawRecord {
  readonly role: AgentTrajectoryRawRecordRole;
  readonly recordId: string;
}

export const trajectoryRawRecordsFor = (item: AgentTrajectoryItem): AgentTrajectoryRawRecord[] => {
  if (item.kind !== "tool") {
    return [{ role: "record", recordId: item.recordId }];
  }

  const records: AgentTrajectoryRawRecord[] = [];
  const callRecordId = item.callSelection?.recordId;
  const resultRecordId = item.resultSelection?.recordId;
  if (callRecordId !== undefined) {
    records.push({ role: "call", recordId: callRecordId });
  }
  if (resultRecordId !== undefined && resultRecordId !== callRecordId) {
    records.push({ role: "result", recordId: resultRecordId });
  }
  return records.length > 0 ? records : [{ role: "record", recordId: item.recordId }];
};
