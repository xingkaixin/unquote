// Bundlers resolve a worker entry from the literal `new Worker(new URL(...))`
// expression, so construction has to stay at the call site and only the
// failure handling is shared here.
export const spawnWorker = (construct: () => Worker): Worker | null => {
  try {
    return construct();
  } catch {
    return null;
  }
};

export interface WorkerRequest {
  post: (message: unknown) => boolean;
  finish: () => boolean;
  terminate: () => boolean;
  setTimeout: (callback: () => void, timeoutMs: number) => void;
}

interface WorkerRequestOptions<Response> {
  onMessage: (event: MessageEvent<Response>) => void;
  onFailure: () => void;
  onTerminate?: () => void;
}

export const createWorkerRequest = <Response>(
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

  function fail() {
    if (terminate()) {
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
      } catch {
        // Structured-clone failures are synchronous and must settle the request.
        fail();
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
