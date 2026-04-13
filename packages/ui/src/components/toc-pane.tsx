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
  <Card className="hidden min-h-0 flex-1 overflow-hidden border-zinc-900/10 bg-[#fffdf9] shadow-[0_20px_50px_rgba(15,23,42,0.06)] lg:flex lg:flex-col">
    <CardHeader>
      <CardTitle>记录导航</CardTitle>
      <CardDescription>
        {result.stats.success} ok · {result.stats.failed} err
      </CardDescription>
    </CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-2">
          {result.records.map((record) => {
            const active = activeRecordId === record.id;
            const variant = record.node ? "success" : "danger";
            return (
              <Button
                key={record.id}
                variant="ghost"
                className={`h-auto justify-start rounded-2xl border px-3 py-3 text-left ${active ? "border-zinc-900/10 bg-white shadow-sm" : "border-transparent bg-transparent"}`}
                onClick={() => onSelect(record)}
              >
                <div className="flex w-full flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-zinc-500">#{record.lineNumber}</span>
                    <Badge variant={variant}>{record.node ? "ok" : "err"}</Badge>
                  </div>
                  <span className="truncate text-sm text-zinc-800">{record.summary}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    </CardContent>
  </Card>
);
