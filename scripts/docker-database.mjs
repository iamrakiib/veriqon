// Stream binary archives directly; shell redirection can corrupt dumps on Windows PowerShell.
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  project: { type: 'string' }, 'env-file': { type: 'string', default: '.env.docker' }, file: { type: 'string' },
} });
const action = positionals[0];
if (!['backup', 'restore'].includes(action) || positionals.length !== 1 || !values.file || !/^[a-z0-9][a-z0-9_-]+$/.test(values.project || '')) {
  throw new Error('Usage: node scripts/docker-database.mjs backup|restore --project NAME --env-file .env.docker --file ARCHIVE');
}
const compose = ['compose', '-p', values.project, '--env-file', resolve(values['env-file']), '-f', resolve('compose.yaml')];
const path = resolve(values.file);
function output(args) { return execFileSync('docker', [...compose, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function transfer(args, input, destination) {
  const child = spawn('docker', [...compose, 'exec', '-T', 'postgres', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  // Do not log database errors containing source values or credentials.
  child.stderr.resume();
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`PostgreSQL ${action} failed; archive not accepted.`)));
  });
  try {
    if (input) { child.stdout.resume(); await Promise.all([completed, pipeline(input, child.stdin)]); }
    else { child.stdin.end(); await Promise.all([completed, pipeline(child.stdout, destination)]); }
  } catch (error) { child.kill(); input?.destroy(); destination?.destroy(); throw error; }
}
try {
  if (action === 'backup') {
    // Reserve a new file atomically; never overwrite an existing backup.
    const fd = openSync(path, 'wx', 0o600); closeSync(fd);
    try { await transfer(['pg_dump', '-U', 'veriqon', '-d', 'veriqon', '--format=custom'], null, createWriteStream(path)); }
    catch (error) { unlinkSync(path); throw error; }
  } else {
    const running = output(['ps', '--services', '--status', 'running']).split(/\r?\n/);
    if (running.some(service => ['api', 'worker', 'web'].includes(service))) throw new Error('Stop api, worker and web in the target project before restore.');
    const count = output(['exec', '-T', 'postgres', 'psql', '-U', 'veriqon', '-d', 'veriqon', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"]);
    if (count !== '0') throw new Error('Restore requires an empty target database. Use a NEW Compose project; existing data is never dropped.');
    await transfer(['pg_restore', '-U', 'veriqon', '-d', 'veriqon', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error'], createReadStream(path));
  }
  console.log(`${action} completed for project ${values.project}. Keep the archive and matching private configuration secure.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
