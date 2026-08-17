import axios from 'axios';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function normalizeApiError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { error?: string; message?: string } | undefined;
    const status = error.response?.status;
    const friendly = status === 403
      ? 'You do not have permission to perform this action.'
      : status === 429
        ? 'Too many requests. Please wait a moment and try again.'
        : status && status >= 500
          ? 'The service is temporarily unavailable. Please try again.'
          : body?.error || body?.message || fallback;
    return new ApiError(friendly, status, error.response?.headers?.['x-request-id']);
  }
  return new ApiError(error instanceof Error ? error.message : fallback);
}

export function getErrorMessage(error: unknown, fallback?: string) {
  const normalized = normalizeApiError(error, fallback);
  return normalized.requestId ? `${normalized.message} Reference: ${normalized.requestId}` : normalized.message;
}
