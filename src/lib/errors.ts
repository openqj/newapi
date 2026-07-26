export type AppError = {
  message: string;
  cause?: unknown;
};

/** Converts backend and network failures into a safe, user-facing message. */
export function toAppError(reason: unknown, fallback = "操作失败，请稍后重试。 "): AppError {
  if (reason instanceof Error && reason.message.trim()) {
    return { message: reason.message, cause: reason };
  }
  if (typeof reason === "string" && reason.trim()) {
    return { message: reason, cause: reason };
  }
  return { message: fallback, cause: reason };
}

export function errorMessage(reason: unknown, fallback?: string) {
  return toAppError(reason, fallback).message;
}
