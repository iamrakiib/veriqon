import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('Docker deployment separates consumers, persists queues and exposes only loopback web', () => {
  const directory = mkdtempSync(join(tmpdir(), 'veriqon-compose-'));
  try {
    const file = join(directory, 'settings');
    writeFileSync(file, 'POSTGRES_PASSWORD=synthetic_database_password\nJWT_SECRET=synthetic_jwt_secret_at_least_32_chars\nSETUP_CODE=synthetic_setup_code_24_chars\n');
    const config = JSON.parse(execFileSync('docker', ['compose', '--env-file', file, '-f', resolve('compose.yaml'), 'config', '--format', 'json'], { encoding: 'utf8' }));
    const { api, worker, redis, postgres, web } = config.services;
    assert.ok(worker, 'A separately supervised worker is required');
    assert.equal(api.environment.VERIQON_PROCESS_ROLE, 'api');
    assert.equal(worker.environment.VERIQON_PROCESS_ROLE, 'worker');
    assert.equal(worker.environment.JOB_QUEUE_MODE, 'bullmq');
    assert.equal(worker.environment.DATABASE_URL, api.environment.DATABASE_URL);
    assert.equal(worker.environment.QUEUE_REDIS_URL, api.environment.QUEUE_REDIS_URL);
    assert.ok(worker.healthcheck.test.join(' ').includes('worker-health'));
    assert.ok(redis.command.join(' ').includes('--appendonly yes'));
    assert.ok(redis.command.join(' ').includes('--maxmemory-policy noeviction'));
    assert.ok(redis.volumes.some(v => v.type === 'volume' && v.target === '/data'));
    assert.ok(postgres.volumes.some(v => v.type === 'volume'));
    for (const service of [api, worker, redis, postgres]) assert.equal(service.ports, undefined);
    assert.ok(web.ports.every(p => p.host_ip === '127.0.0.1'));
    assert.equal(web.depends_on.worker.condition, 'service_healthy');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.includes('veriqon-compose-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
