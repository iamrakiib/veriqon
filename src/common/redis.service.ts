import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { createClient } from 'redis';
import { createHash, randomUUID } from 'node:crypto';

const acquire = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ms)
if redis.call('EXISTS',KEYS[2])==1 then return 1 end
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) then return 2 end
redis.call('SET',KEYS[2],ARGV[1],'PX',300000)
redis.call('ZADD',KEYS[1],ms+300000,ARGV[1]); redis.call('PEXPIRE',KEYS[1],300000)
return 0`;
const release = `if redis.call('GET',KEYS[2])==ARGV[1] then redis.call('DEL',KEYS[2]) end; return redis.call('ZREM',KEYS[1],ARGV[1])`;
const renew = `
if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
redis.call('PEXPIRE',KEYS[2],300000); redis.call('ZADD',KEYS[1],ms+300000,ARGV[1]); redis.call('PEXPIRE',KEYS[1],300000); return 1`;
const increment = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client?: ReturnType<typeof createClient>;
  readonly enabled = Boolean(process.env.REDIS_URL);
  private readonly prefix = process.env.REDIS_PREFIX || 'veriqon';
  constructor() {
    if (process.env.NODE_ENV === 'production' && !this.enabled) throw new Error('REDIS_URL is required in production for shared admission control.');
    if (this.enabled) {
      this.client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
        socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(250 * (retries + 1), 5000) } });
      this.client.on('error', () => console.error('Redis is unavailable; protected work fails closed.'));
    }
  }
  async onModuleInit() { if (this.client) await this.client.connect(); }
  async onModuleDestroy() { if (this.client?.isOpen) this.client.destroy(); }
  private async eval(script: string, keys: string[], args: string[]) {
    if (!this.client?.isReady) throw new ServiceUnavailableException('Request coordination is unavailable. Please retry shortly.');
    try { return Number(await this.client.eval(script, { keys, arguments: args })); }
    catch { throw new ServiceUnavailableException('Request coordination is unavailable. Please retry shortly.'); }
  }
  async ping() {
    if (!this.enabled) return;
    if (!this.client?.isReady) throw new Error('Redis unavailable');
    await this.client.ping();
  }
  async limit(key: string, maximum: number, milliseconds: number, message: string) {
    const hash = createHash('sha256').update(key).digest('hex');
    const count = await this.eval(increment, [`${this.prefix}:rate:${hash}`], [String(milliseconds)]);
    if (count > maximum) throw new HttpException(message, 429);
  }
  async run<T>(owner: string, task: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const keys = [`${this.prefix}:{admission}:active`, `${this.prefix}:{admission}:owner:${owner}`];
    const status = await this.eval(acquire, keys, [token, '4']);
    if (status === 1) throw new HttpException('Another operation is running in your account. Wait for it to finish, then retry.', 429);
    if (status === 2) throw new HttpException('The server is busy. Please retry shortly.', 429);
    let lost = false;
    const heartbeat = setInterval(() => { void this.eval(renew, keys, [token]).then(ok => { if (!ok) lost = true; }).catch(() => { lost = true; }); }, 30000);
    heartbeat.unref();
    try {
      const result = await task();
      if (lost) throw new ServiceUnavailableException('Request coordination was interrupted. Check saved history before retrying.');
      return result;
    } finally {
      clearInterval(heartbeat);
      await this.eval(release, keys, [token]).catch(() => undefined); // crashed leases expire
    }
  }
}
