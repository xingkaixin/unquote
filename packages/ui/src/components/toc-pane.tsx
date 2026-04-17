import type { JsonlRecord, ParseResult } from "@unquote/core";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

interface TocPaneProps {
  result: ParseResult;
  activeRecordId: string | null;
  onSelect: (record: JsonlRecord) => void;
}

export const TocPane = ({ result, activeRecordId, onSelect }: TocPaneProps) => (
  <Card className="hidden min-h-0 flex-1 overflow-hidden bg-surface-50 lg:flex lg:flex-col">
    <CardHeader>
      <CardTitle>记录导航</CardTitle>
      <CardDescription>
        {result.stats.success} ok · {result.stats.failed} err
      </CardDescription>
    </CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        <div className="flex flex-col gap-1">
          {result.records.map((record) => {
            const active = activeRecordId === record.id;
            const variant = record.node ? "success" : "danger";
            return (
              <Button
                key={record.id}
                variant="ghost"
                className={`h-auto justify-start rounded-md border px-3 py-2.5 text-left ${active ? "border-border bg-surface-100 shadow-sm" : "border-transparent"}`}
                onClick={() => onSelect(record)}
              >
                <div className="flex w-full flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-text-muted">
                      #{record.lineNumber}
                    </span>
                    <Badge variant={variant}>{record.node ? "ok" : "err"}</Badge>
                  </div>
                  <span className="truncate text-[13px] text-text-secondary">{record.summary}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    </CardContent>
  </Card>
);
