import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
const file = process.argv.find(arg => arg.startsWith('--env='))?.slice(6) || '.env';
const env = { ...(existsSync(file) ? parse(readFileSync(file)) : {}), ...process.env };
const [major, minor] = process.versions.node.split('.').map(Number);
const checks = [
  { name: 'Node 22.18 or newer', passed: major > 22 || major === 22 && minor >= 18 },
  { name: 'Dependencies installed', passed: existsSync('node_modules/typescript/package.json') },
  { name: 'Private configuration exists', passed: existsSync(file) },
  { name: 'JWT secret configured', passed: Boolean(env.JWT_SECRET && env.JWT_SECRET.length >= 32) },
];
const provider = ['OPENROUTER_API_KEY', 'EMBEDDING_MODEL', 'LLM_MODEL'].map(key => ({ setting: key, configured: Boolean(env[key]?.trim()) }));
console.log(JSON.stringify({ checks, provider, providerCallsMade: 0,
  note: 'Configuration check only. Offline research demo needs no credentials. Live documents require available models and quota; this command does not establish provider availability.' }, null, 2));
if (checks.some(check => !check.passed) || process.argv.includes('--require-provider') && provider.some(check => !check.configured)) process.exitCode = 1;
