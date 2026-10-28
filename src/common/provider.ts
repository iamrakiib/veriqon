import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { setTimeout as delay } from 'timers/promises';

export async function withProviderRetry<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try { return await request(); }
  catch (error) {
    const failure = error as { status?: number; headers?: Record<string, string> };
    if (![429, 500, 502, 503, 504].includes(failure.status || 0) || signal.aborted) throw error;
    const retryAfter = failure.headers?.['retry-after'];
    const seconds = retryAfter ? Number(retryAfter) : 2;
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
    timeout: 25000,
    maxRetries: 0,
    defaultHeaders: { 'X-Title': 'Veriqon' }
  });
}

export function requireProvider() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new ServiceUnavailableException('Add OPENROUTER_API_KEY to the server .env file, then restart the API.');
}

// Do not return raw provider messages: they can contain credentials or document text.
export function providerError(error: unknown, operation: string): HttpException {
  if (error instanceof HttpException) return error;
  const status = (error as { status?: number })?.status;
  const name = (error as { name?: string })?.name;
  const advice = status === 401 ? 'The provider rejected the API key. Check OPENROUTER_API_KEY.'
    : status === 402 ? 'The provider has insufficient credits. Check your account balance or use an available free model.'
    : status === 403 ? 'The provider denied access. Check account permissions and provider privacy settings.'
    : status === 404 || status === 400 ? 'The configured model or request is unavailable. Check LLM_MODEL, VERIFIER_MODEL and EMBEDDING_MODEL.'
    : status === 429 ? 'The provider rate limit was reached. Wait a moment and retry, or choose another model.'
    : /Timeout|Abort/.test(name || '') ? 'The provider took too long to respond. Retry or choose a faster model.'
    : 'The model provider is unavailable. Check the connection and retry.';
  return new HttpException(`${operation}: ${advice}`, status === 429 ? 429 : 502);
}
