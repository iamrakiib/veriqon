import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
try {
  const template = readFileSync('.env.example', 'utf8')
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString('hex')}`)
    .replace(/^SETUP_CODE=.*$/m, `SETUP_CODE=${randomBytes(32).toString('hex')}`)
    .replace(/^EMBEDDING_BATCH_SIZE=.*$/m, 'EMBEDDING_BATCH_SIZE=1');
  writeFileSync('.env', template, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env with independent local secrets. Configure your provider key and model names there. First-owner registration uses SETUP_CODE from this file.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Existing .env preserved.'); else throw error;
}
