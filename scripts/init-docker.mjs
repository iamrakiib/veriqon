import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

try {
  const settings = ['POSTGRES_PASSWORD', 'JWT_SECRET', 'SETUP_CODE'].map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n');
  writeFileSync('.env.docker', `${settings}\nALLOW_REGISTRATION=false\nOPENROUTER_API_KEY=\nLLM_MODEL=\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env.docker settings. Add your provider key/model there before asking questions.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Existing .env.docker preserved.');
  else throw error;
}
