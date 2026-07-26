const prefix = "unquote";

const canMeasure = () => typeof performance !== "undefined";

export const markPerf = (name: string) => {
  if (!canMeasure()) {
    return;
  }

  performance.mark(`${prefix}:${name}`);
};

export const measurePerf = (name: string, startName: string, endName?: string) => {
  if (!canMeasure()) {
    return;
  }

  try {
    performance.measure(
      `${prefix}:${name}`,
      `${prefix}:${startName}`,
      endName ? `${prefix}:${endName}` : undefined,
    );
  } catch {
    // Marks are best-effort diagnostics and must not affect app behavior.
  }
};

export const startPerfMeasure = (name: string) => {
  if (!canMeasure()) {
    return () => undefined;
  }

  const startedAt = performance.now();
  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      performance.measure(`${prefix}:${name}`, { start: startedAt, end: performance.now() });
    } catch {
      // Measurements are diagnostics and must not affect app behavior.
    }
  };
};

export const measurePerfFn = <T>(name: string, fn: () => T): T => {
  if (!canMeasure()) {
    return fn();
  }

  const start = `${prefix}:${name}:start`;
  const end = `${prefix}:${name}:end`;
  performance.mark(start);
  try {
    return fn();
  } finally {
    performance.mark(end);
    try {
      performance.measure(`${prefix}:${name}`, start, end);
    } catch {
      // Ignore measurement failures from unusual browser environments.
    }
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
};

export const measurePerfAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const finish = startPerfMeasure(name);
  try {
    return await fn();
  } finally {
    finish();
  }
};
