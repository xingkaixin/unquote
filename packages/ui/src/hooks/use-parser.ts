import type { ParseResult } from "@unquote/core";
import { useEffect, useRef, useState } from "react";
import { parseInput } from "@unquote/core";

const withForcedFormat = (forcedFormat?: "json" | "jsonl") =>
  forcedFormat ? { forcedFormat } : {};

export const useParser = (input: string, forcedFormat?: "json" | "jsonl") => {
  const [result, setResult] = useState<ParseResult>(() =>
    parseInput(input, withForcedFormat(forcedFormat)),
  );
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      setResult(parseInput(input, withForcedFormat(forcedFormat)));
      return;
    }

    workerRef.current ??= new Worker(new URL("../worker/parser-worker.ts", import.meta.url), {
      type: "module",
    });

    const currentWorker = workerRef.current;
    const timeoutId = window.setTimeout(() => {
      currentWorker.postMessage({ input, forcedFormat });
    }, 120);

    const onMessage = (event: MessageEvent<ParseResult>) => {
      setResult(event.data);
    };

    currentWorker.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timeoutId);
      currentWorker.removeEventListener("message", onMessage);
    };
  }, [forcedFormat, input]);

  return result;
};
