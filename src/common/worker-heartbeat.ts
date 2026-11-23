import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Only enabled by deployments that supervise one worker per heartbeat path. */
export class WorkerHeartbeat {
  constructor(private readonly path = process.env.WORKER_HEARTBEAT_PATH) {}
  clear() { if (this.path) rmSync(this.path, { force: true }); }
  record() {
    if (!this.path) return;
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ pid: process.pid, checkedAt: Date.now() }), { mode: 0o600 });
      renameSync(temporary, this.path);
    } finally { rmSync(temporary, { force: true }); }
  }
}

/** Successful dispatch proves SQL and queue progress, not correctness of model answers. */
export function workerHealthy(path = process.env.WORKER_HEARTBEAT_PATH, now = Date.now()): boolean {
  if (!path) return false;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(state.pid) || state.pid < 1 || !Number.isSafeInteger(state.checkedAt) ||
        state.checkedAt > now || now - state.checkedAt > 60000) return false;
    process.kill(state.pid, 0);
    return true;
  } catch { return false; }
}
