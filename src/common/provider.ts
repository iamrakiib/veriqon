import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { setTimeout as delay } from 'timers/promises';

export function providerRetryAfter(error: unknown, now = Date.now()): number | undefined {
  const headers = (error as { headers?: Headers | Record<string, string> } | null)?.headers;
  if (!headers) return undefined;
  const header = (name: string) => typeof (headers as Headers).get === 'function' ? (headers as Headers).get(name)
    : Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const raw = header('retry-after');
  if (typeof raw === 'string' && raw.trim()) {
    const seconds = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : (Date.parse(raw) - now) / 1000;
    if (Number.isFinite(seconds) && seconds <= 366 * 86400) return Math.max(0, Math.ceil(seconds));
  }
  // OpenRouter platform quota responses can supply an absolute millisecond reset
  // instead of Retry-After. Do not interpret short, ambiguous counters as dates.
  const reset = header('x-ratelimit-reset');
  if (typeof reset !== 'string' || !/^\d{13}$/.test(reset.trim())) return undefined;
  return Math.max(0, Math.ceil((Number(reset) - now) / 1000));
}

export async function withProviderRetry<T>(request: () => Promise<T>, signal: AbortSignal, retryRateLimits = true): Promise<T> {
  signal.throwIfAborted();
  try { return await request(); }
  catch (error) {
    const failure = error as { status?: number; name?: string; headers?: Record<string, string> };
    if (failure.status === 429 && !retryRateLimits) throw error;
    const transientConnection = /^(?:APIConnectionTimeoutError|APIConnectionError|TimeoutError)$/.test(failure.name || '');
    if ((!transientConnection && ![429, 500, 502, 503, 504].includes(failure.status || 0)) || signal.aborted) throw error;
    const retryAfter = providerRetryAfter(error);
    // An unknown rate-limit reset is not evidence that a sub-second retry can succeed.
    if (failure.status === 429 && retryAfter === undefined) throw error;
    const seconds = retryAfter ?? 0.5 + Math.random() * 0.5;
    // Long provider cooldowns belong in the error UI, not a blocked composer.
    if (!Number.isFinite(seconds) || seconds > 5 || seconds < 0) throw error;
    await delay(Math.max(500, seconds * 1000), undefined, { signal });
    return request();
  }
}

export function providerClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || 'not-configured',
    baseURL: process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1',
    timeout: providerTimeout(),
    maxRetries: 0,
    defaultHeaders: { 'X-Title': 'Veriqon' }
  });
}

export function providerTimeout() {
  const value = Number(process.env.PROVIDER_TIMEOUT_MS || 45000);
  if (!Number.isInteger(value) || value < 5000 || value > 90000) throw new Error('PROVIDER_TIMEOUT_MS must be between 5000 and 90000.');
  return value;
}

export function requireProvider() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new ServiceUnavailableException('Add OPENROUTER_API_KEY to the server .env file, then restart the API.');
}

// Do not return raw provider messages: they can contain credentials or document text.
export function providerError(error: unknown, operation: string): HttpException {
  if (error instanceof HttpException) return error;
  const status = (error as { status?: number })?.status;
  const name = (error as { name?: string })?.name;
  const retryAfter = providerRetryAfter(error);
  const resetAdvice = retryAfter === undefined ? 'No reset time was supplied. Retry later'
    : retryAfter < 3600 ? `Retry in ${retryAfter} seconds`
    : `The provider reports a reset at ${new Date(Date.now() + retryAfter * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC. Retry after that time`;
  const advice = status === 401 ? 'The provider rejected the API key. Check OPENROUTER_API_KEY.'
    : status === 402 ? 'The provider has insufficient credits. Check your account balance or use an available free model.'
    : status === 403 ? 'The provider denied access. Check account permissions and provider privacy settings.'
    : status === 404 || status === 400 ? 'The configured model or request is unavailable. Check LLM_MODEL, VERIFIER_MODEL and EMBEDDING_MODEL.'
    : status === 429 ? `The provider rate limit was reached. ${resetAdvice}.`
    : /Timeout|Abort/.test(name || '') ? 'The provider took too long to respond. Retry or choose a faster model.'
    : 'The model provider is unavailable. Check the connection and retry.';
  return Object.assign(new HttpException(`${operation}: ${advice}`, status === 429 ? 429 : /Timeout|Abort/.test(name || '') ? 504 : 502), {
    retryable: ![400,401,402,403,404,413,422].includes(status || 0), retryAfterSeconds: retryAfter
  });
}
