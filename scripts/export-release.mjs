import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { auditSources } from './release-tools.mjs';

const result = auditSources();
if (!result.passed) throw new Error('Release audit failed. Run npm run release:audit; no files were exported.');
const hash = createHash('sha256').update(JSON.stringify(result.manifest)).digest('hex');
// Outside this checkout: Node must not find the developer's node_modules in a parent directory.
const destination = resolve(tmpdir(), `veriqon-release-${hash.slice(0, 12)}`);
mkdirSync(destination); // Refuse to overwrite an existing candidate or unrelated files.
for (const file of result.manifest) {
  const target = resolve(destination, file.path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(file.path, target);
}
writeFileSync(resolve(destination, 'release-manifest.json'), JSON.stringify({ sourceHash: hash, files: result.manifest }, null, 2));
console.log(JSON.stringify({ destination, sourceHash: hash, files: result.files }));
