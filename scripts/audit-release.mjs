import { auditSources } from './release-tools.mjs';
const result = auditSources(process.cwd(), process.argv.includes('--history'));
console.log(JSON.stringify({ ...result, manifest: undefined }, null, 2)); // Reports locations/rules, never matched secret values.
if (!result.passed) process.exitCode = 1;
