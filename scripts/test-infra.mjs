// Explicit test endpoints only; never falls back to DATABASE_URL or .env.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--test', 'dist/src/tests/infra.test.js', 'dist/src/tests/auth.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test',
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://veriqon_test:local_test_only@127.0.0.1:55432/veriqon_test',
    TEST_REDIS_URL: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:56379' }
});
process.exit(result.status ?? 1);
