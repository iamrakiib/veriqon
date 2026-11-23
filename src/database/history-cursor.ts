import { BadRequestException } from '@nestjs/common';

export function historyCursor(time: number, id: string) {
  return Buffer.from(JSON.stringify([time, id])).toString('base64url');
}

export function readHistoryCursor(value?: string): [number, string] | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string' || !value.length || value.length > 300 || !/^[\w-]+$/.test(value)) throw new Error();
    const pair: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) || pair[0] < 0 || typeof pair[1] !== 'string' || !/^[\w-]{1,160}$/.test(pair[1])) throw new Error();
    return pair as [number, string];
  } catch { throw new BadRequestException('Invalid history cursor. Refresh chat history.'); }
}
