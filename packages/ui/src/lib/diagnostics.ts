export interface DiagnosticError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values and promise rejections are not restricted to Error instances.
const unknownErrorName = (error: unknown) =>
  error === null ? "null" : Array.isArray(error) ? "array" : typeof error;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values and promise rejections are not restricted to Error instances.
export const serializeDiagnosticError = (error: unknown): DiagnosticError => {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const stack = "stack" in error && typeof error.stack === "string" ? error.stack : undefined;
    return { name: error.name, message: error.message, ...(stack ? { stack } : {}) };
  }

  return {
    name: unknownErrorName(error),
    message: typeof error === "string" ? error : "Unknown failure",
  };
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values and promise rejections are not restricted to Error instances.
export const reportDiagnostic = (operation: string, error: unknown) => {
  console.error(`[Unquote] ${operation}`, serializeDiagnosticError(error));
};
