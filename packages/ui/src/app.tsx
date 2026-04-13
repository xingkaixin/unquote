import type { JsonlRecord } from "@unquote/core";
import { formatResult } from "@unquote/core";
import { PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InputPane } from "./components/input-pane";
import { RecordList } from "./components/record-list";
import { TocPane } from "./components/toc-pane";
import { Toolbar } from "./components/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useParser } from "./hooks/use-parser";
import { collectStringifiedPaths, hasJsonlRecords, materializeRecord } from "./lib/tree";
import type { TreeRow } from "./lib/tree";

export interface UnquoteAppProps {
  initialInput?: string;
  onSourceChange?: (value: string) => void;
  onOpenFile?: () => Promise<string | null> | string | null | void;
  onReadFile?: (file: File) => Promise<string>;
}

export const UnquoteApp = ({
  initialInput = "",
  onSourceChange,
  onOpenFile,
  onReadFile,
}: UnquoteAppProps) => {
  const [sourceText, setSourceText] = useState(initialInput);
  const [mode, setMode] = useState<"auto" | "json" | "jsonl">("auto");
  const [hoveredPath, setHoveredPath] = useState("$");
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [expandedStringifiedPaths, setExpandedStringifiedPaths] = useState<Set<string>>(new Set());
  const [restoredRecordIds, setRestoredRecordIds] = useState<Set<string>>(new Set());
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const result = useParser(sourceText, mode === "auto" ? undefined : mode);
  const detectedFormat = mode === "auto" ? result.format : mode;

  useEffect(() => {
    onSourceChange?.(sourceText);
  }, [onSourceChange, sourceText]);

  useEffect(() => {
    const firstRecord = result.records[0];
    setActiveRecordId((current) => current ?? firstRecord?.id ?? null);
  }, [result.records]);

  const handleSourceChange = (value: string) => {
    setSourceText(value);
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(new Set());
  };

  const handleFileDrop = async (file: File) => {
    const text = onReadFile ? await onReadFile(file) : await file.text();
    handleSourceChange(text);
  };

  const handleOpenFile = async () => {
    const text = await onOpenFile?.();
    if (typeof text === "string") {
      handleSourceChange(text);
    }
  };

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(formatResult(result));
  };

  const handleExpandAll = () => {
    const all = new Set<string>();
    result.records.forEach((record) => {
      collectStringifiedPaths(record, expandedStringifiedPaths, restoredRecordIds).forEach(
        (path) => {
          all.add(path);
        },
      );
    });
    setRestoredRecordIds(new Set());
    setExpandedStringifiedPaths(all);
  };

  const handleRestoreAll = () => {
    setExpandedStringifiedPaths(new Set());
    setRestoredRecordIds(
      new Set(result.records.filter((record) => record.node).map((record) => record.id)),
    );
  };

  const handleTogglePath = (path: string) => {
    setExpandedStringifiedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleCopyRecord = async (record: JsonlRecord) => {
    const value = materializeRecord(record, restoredRecordIds);
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const handleCopyNode = async (_recordId: string, row: TreeRow) => {
    await navigator.clipboard.writeText(JSON.stringify(row.node.value, null, 2));
  };

  const handleSelectRecord = (record: JsonlRecord) => {
    setActiveRecordId(record.id);
    const element = document.getElementById(record.id);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  useEffect(() => {
    if (!outputRef.current || result.records.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveRecordId(visible.target.id);
        }
      },
      {
        root: null,
        threshold: [0.3, 0.6, 0.9],
      },
    );

    result.records.forEach((record) => {
      const element = document.getElementById(record.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [result.records]);

  const statsLabel = `${result.stats.total} total · ${result.stats.success} ok · ${result.stats.failed} err`;
  const output = (
    <div ref={outputRef} className="flex flex-col gap-4">
      <Toolbar
        detectedFormat={detectedFormat}
        pathLabel={hoveredPath}
        statsLabel={statsLabel}
        onCopyAll={handleCopyAll}
        onExpandAll={handleExpandAll}
        onRestoreAll={handleRestoreAll}
      />
      <RecordList
        records={result.records}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        onTogglePath={handleTogglePath}
        onCopyRecord={handleCopyRecord}
        onCopyPath={(path) => navigator.clipboard.writeText(path)}
        onCopyNode={handleCopyNode}
        onRestoreRecord={(recordId) =>
          setRestoredRecordIds((current) => new Set(current).add(recordId))
        }
        onHoverPath={(path) => setHoveredPath(path ?? "$")}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f1e6_0%,#f3ede0_34%,#efe9db_100%)] text-zinc-950">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5">
        <header className="rounded-[28px] border border-zinc-900/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(248,244,236,0.96))] px-5 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] lg:px-7">
          <div className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">
              UNQUOTE
            </div>
            <div className="max-w-4xl">
              <h1 className="font-serif text-[clamp(1.8rem,2.3vw,2.8rem)] leading-none tracking-[-0.03em]">
                Stringify 进去的，Unquote 拿出来。
              </h1>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-zinc-600">
              递归检测、展开、还原。JSON 和 JSONL 粘贴即用，agent 日志和模型输出的日常查看工具。
            </p>
          </div>
        </header>

        <Tabs defaultValue="workspace" className="flex flex-col gap-4 lg:hidden">
          <TabsList>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace">
            <InputPane
              value={sourceText}
              mode={mode}
              onChange={handleSourceChange}
              onModeChange={setMode}
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
            />
          </TabsContent>
          <TabsContent value="output">{output}</TabsContent>
        </Tabs>

        <div
          className={`hidden items-start gap-4 lg:grid ${sourceCollapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(420px,520px)_minmax(0,1fr)]"}`}
        >
          <div className="sticky top-4 flex max-h-[calc(100vh-2rem)] flex-col gap-4 overflow-hidden">
            <InputPane
              value={sourceText}
              mode={mode}
              onChange={handleSourceChange}
              onModeChange={setMode}
              onOpenFile={handleOpenFile}
              onFileDrop={handleFileDrop}
              onClear={() => handleSourceChange("")}
              onToggleCollapse={() => setSourceCollapsed((current) => !current)}
              collapsed={sourceCollapsed}
            />
            {sourceCollapsed ? (
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-900/10 bg-white text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500 shadow-sm"
                onClick={() => setSourceCollapsed(false)}
              >
                <PanelLeftOpen className="size-4" />
                展开
              </button>
            ) : hasJsonlRecords(result) ? (
              <TocPane
                result={result}
                activeRecordId={activeRecordId}
                onSelect={handleSelectRecord}
              />
            ) : null}
          </div>
          <div className="min-w-0">{output}</div>
        </div>
      </div>
    </div>
  );
};
