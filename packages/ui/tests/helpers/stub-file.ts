import { vi } from "vitest";

const fileType = (name: string) =>
  name.toLowerCase().endsWith(".jsonl") ? "application/jsonl" : "application/json";

const defineStream = (file: File, stream: () => ReadableStream<Uint8Array>) => {
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: stream,
  });
};

export const createStreamFile = (contents: string, name = "payload.json") => {
  const file = new File([contents], name, { type: fileType(name) });
  const stream = vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(contents));
          controller.close();
        },
      }),
  );
  defineStream(file, stream);
  return { file, stream };
};

export const createFailingStreamFile = (error: unknown, name = "payload.json", contents = "") => {
  const file = new File([contents], name, { type: fileType(name) });
  const stream = vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(error);
        },
      }),
  );
  defineStream(file, stream);
  return { file, stream };
};

export const createControlledStreamFile = (contents: string, name = "payload.json") => {
  const file = new File([contents], name, { type: fileType(name) });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let hasEnqueued = false;
  const stream = vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
        },
      }),
  );
  const activeController = () => {
    if (!controller) {
      throw new Error("File stream has not started");
    }
    return controller;
  };

  defineStream(file, stream);

  return {
    file,
    stream,
    enqueue(chunk: string) {
      hasEnqueued = true;
      activeController().enqueue(new TextEncoder().encode(chunk));
    },
    complete(chunk?: string) {
      if (chunk !== undefined) {
        activeController().enqueue(new TextEncoder().encode(chunk));
      } else if (!hasEnqueued) {
        activeController().enqueue(new TextEncoder().encode(contents));
      }
      activeController().close();
    },
    fail(error: unknown) {
      activeController().error(error);
    },
  };
};
