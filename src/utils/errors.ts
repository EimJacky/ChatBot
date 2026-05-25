export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isOperational = true,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toAppError(error: unknown, fallbackCode = 'UNKNOWN_ERROR'): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, fallbackCode, false, error);
  }

  return new AppError(String(error), fallbackCode, false, error);
}

export function userFacingError(error: unknown): string {
  const appError = toAppError(error);

  switch (appError.code) {
    case 'RATE_LIMITED':
      return appError.message;
    case 'PROMPT_BLOCKED':
      return appError.message;
    case 'INPUT_TOO_LONG':
      return appError.message;
    case 'AI_AUTH_ERROR':
      return 'AI service authentication failed. Please check the API key.';
    case 'AI_MODEL_ERROR':
      return 'The configured AI model is unavailable or invalid.';
    case 'AI_TIMEOUT':
      return 'The AI response timed out. Please try again with a shorter request.';
    default:
      return 'Something went wrong while handling that request.';
  }
}

