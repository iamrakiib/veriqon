export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'SETUP_CODE', 'APP_ORIGINS'] as const) {
    if (!env[key]?.trim()) throw new Error(`${key} is required in production.`);
  }
  if (env.JWT_SECRET!.length < 32 || env.SETUP_CODE!.length < 24) throw new Error('JWT_SECRET and SETUP_CODE must be independently generated strong secrets.');
  if (env.JWT_SECRET === env.SETUP_CODE) throw new Error('JWT_SECRET and SETUP_CODE must be different.');
  const local = env.ALLOW_INSECURE_LOCAL_HTTP === 'true';
  for (const origin of env.APP_ORIGINS!.split(',').map(value => value.trim())) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(local && ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'))) {
      throw new Error('APP_ORIGINS must contain exact HTTPS origins. Local Docker may explicitly allow loopback HTTP.');
    }
  }
  if (!local && env.AUTH_COOKIE_SECURE === 'false') throw new Error('Production cookies must be Secure.');
  if (!['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL!).protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  if (!['redis:', 'rediss:'].includes(new URL(env.REDIS_URL!).protocol)) throw new Error('REDIS_URL must be a Redis URL.');
  const timeout = Number(env.RAG_TIMEOUT_MS || 110000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 150000) throw new Error('RAG_TIMEOUT_MS must be between 1000 and 150000.');
  if (env.RAG_REASONING && !['off', 'low'].includes(env.RAG_REASONING)) throw new Error('RAG_REASONING must be off or low.');
  for (const [key, fallback, min, max] of [['PROVIDER_TIMEOUT_MS', 45000, 5000, 90000], ['MAX_REPAIR_ATTEMPTS', 1, 0, 2], ['RETRIEVAL_CANDIDATES', 30, 12, 80]] as const) {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
}
