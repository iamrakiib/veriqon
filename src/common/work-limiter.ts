import { HttpException } from '@nestjs/common';

// Single-process admission control. A distributed deployment needs shared limits.
export class WorkLimiter {
  private readonly active = new Set<string>();
  async run<T>(owner: string, task: () => Promise<T>): Promise<T> {
    if (this.active.has(owner)) throw new HttpException('Another operation is running in your account. Wait for it to finish, then retry.', 429);
    if (this.active.size >= 4) throw new HttpException('The server is busy. Please retry shortly.', 429);
    this.active.add(owner);
    try { return await task(); } finally { this.active.delete(owner); }
  }
}
