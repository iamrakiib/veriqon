/** Integrated SQL polling is retained for single-process local installations. */
function validUrl(value: string | undefined, protocols: string[]) {
  try { const url = new URL(value || ''); return Boolean(url.hostname) && protocols.includes(url.protocol); }
  catch { return false; }
}
export function backgroundConfig(env: NodeJS.ProcessEnv = process.env) {
  const role = env.VERIQON_PROCESS_ROLE || 'integrated';
  const mode = env.JOB_QUEUE_MODE || 'sql';
  if (!['integrated', 'api', 'worker'].includes(role)) throw new Error('Invalid VERIQON_PROCESS_ROLE.');
  if (!['sql', 'bullmq'].includes(mode)) throw new Error('Invalid JOB_QUEUE_MODE.');
  if ((mode === 'bullmq') !== (role !== 'integrated')) throw new Error('Separate api/worker roles require bullmq; integrated requires sql.');
  if (mode === 'bullmq') {
    if (!validUrl(env.DATABASE_URL, ['postgres:', 'postgresql:'])) throw new Error('Separate workers require PostgreSQL.');
    if (!validUrl(env.QUEUE_REDIS_URL, ['redis:', 'rediss:'])) throw new Error('QUEUE_REDIS_URL is required for durable queues.');
  }
  const prefix = env.QUEUE_PREFIX || 'veriqon-jobs';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(prefix)) throw new Error('QUEUE_PREFIX must be 1-64 letters, digits, underscores or hyphens.');
  return { role, mode, prefix };
}

export function sqlPollingEnabled() {
  return (!process.env.VERIQON_PROCESS_ROLE || process.env.VERIQON_PROCESS_ROLE === 'integrated') &&
    (!process.env.JOB_QUEUE_MODE || process.env.JOB_QUEUE_MODE === 'sql');
}
