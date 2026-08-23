import { reportDiagnostic } from "./diagnostics";

const spawnWorker = (construct: () => Worker): Worker | null => {
  try {
    return construct();
  } catch (error) {
    reportDiagnostic("worker.construct", error);
    return null;
  }
};

interface WorkerRequest {
  post: (message: unknown) => boolean;
  finish: () => boolean;
  terminate: () => boolean;
  setTimeout: (callback: () => void, timeoutMs: number) => void;
}

export interface WorkerRun {
  requestId: number;
  available: boolean;
  isActive: () => boolean;
  post: (message: unknown) => boolean;
  finish: () => boolean;
  cancel: () => boolean;
  setTimeout: (callback: () => void, timeoutMs: number) => void;
}

interface WorkerRunOptions<Response> {
  onMessage: (event: MessageEvent<Response>) => void;
  onFailure: () => void;
  onTerminate?: () => void;
}

export interface WorkerRequestRunner {
  begin: <Response>(options: WorkerRunOptions<Response>) => WorkerRun;
  invalidate: () => void;
  dispose: () => void;
}

interface WorkerRequestOptions<Response> {
  onMessage: (event: MessageEvent<Response>) => void;
  onFailure: () => void;
  onTerminate?: () => void;
}

const createWorkerRequest = <Response>(
  worker: Worker,
  { onMessage, onFailure, onTerminate }: WorkerRequestOptions<Response>,
): WorkerRequest => {
  let active = true;
  let timeoutId: number | null = null;

  const removeListeners = () => {
    worker.removeEventListener("message", onMessage as EventListener);
    worker.removeEventListener("error", fail);
    worker.removeEventListener("messageerror", fail);
  };

  const finish = () => {
    if (!active) {
      return false;
    }

    active = false;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    removeListeners();
    return true;
  };

  const terminate = () => {
    const wasActive = finish();
    if (!wasActive) {
      return false;
    }
    worker.terminate();
    onTerminate?.();
    return true;
  };

  function fail(error?: unknown) {
    if (terminate()) {
      reportDiagnostic("worker.request", error);
      onFailure();
    }
  }

  const request: WorkerRequest = {
    post(message) {
      if (!active) {
        return false;
      }
      try {
        worker.postMessage(message);
        return true;
      } catch (error) {
        // Structured-clone failures are synchronous and must settle the request.
        fail(error);
        return false;
      }
    },
    finish,
    terminate,
    setTimeout(callback, timeoutMs) {
      if (!active) {
        return;
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(callback, timeoutMs);
    },
  };

  worker.addEventListener("message", onMessage as EventListener);
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", fail);
  return request;
};

export const createWorkerRequestRunner = (construct: () => Worker): WorkerRequestRunner => {
  let worker: Worker | null = null;
  let activeRun: WorkerRun | null = null;
  let nextRequestId = 0;

  const begin = <Response>({
    onMessage,
    onFailure,
    onTerminate,
  }: WorkerRunOptions<Response>): WorkerRun => {
    activeRun?.cancel();
    nextRequestId += 1;

    worker ??= typeof Worker === "undefined" ? null : spawnWorker(construct);
    const currentWorker = worker;
    let active = true;
    let posted = false;
    let request: WorkerRequest | null = null;

    const clearActiveRun = () => {
      if (activeRun === run) {
        activeRun = null;
      }
    };

    const finish = () => {
      if (!active) {
        return false;
      }
      active = false;
      const finished = request?.finish() ?? true;
      clearActiveRun();
      return finished;
    };

    const cancel = () => {
      if (!active) {
        return false;
      }
      active = false;
      const cancelled = request ? (posted ? request.terminate() : request.finish()) : true;
      clearActiveRun();
      return cancelled;
    };

    const run: WorkerRun = {
      requestId: nextRequestId,
      available: currentWorker !== null,
      isActive: () => active,
      post(message) {
        if (!active || !request) {
          return false;
        }
        const didPost = request.post(message);
        posted ||= didPost;
        return didPost;
      },
      finish,
      cancel,
      setTimeout(callback, timeoutMs) {
        request?.setTimeout(callback, timeoutMs);
      },
    };
    activeRun = run;

    if (currentWorker) {
      request = createWorkerRequest<Response>(currentWorker, {
        onMessage(event) {
          if (active) {
            onMessage(event);
          }
        },
        onFailure() {
          if (!active) {
            return;
          }
          active = false;
          clearActiveRun();
          onFailure();
        },
        onTerminate() {
          if (worker === currentWorker) {
            worker = null;
          }
          onTerminate?.();
        },
      });
    }

    return run;
  };

  return {
    begin,
    invalidate() {
      activeRun?.cancel();
      activeRun = null;
      nextRequestId += 1;
    },
    dispose() {
      activeRun?.cancel();
      activeRun = null;
      worker?.terminate();
      worker = null;
    },
  };
};
