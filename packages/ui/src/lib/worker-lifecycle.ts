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

// `postMessage` throws synchronously when the payload cannot be structured
// cloned, which would otherwise escape a React effect instead of ending the
// request.
export const postToWorker = (worker: Worker, message: unknown): boolean => {
  try {
    worker.postMessage(message);
    return true;
  } catch {
    return false;
  }
};
