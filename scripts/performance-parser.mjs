// Isolated synthetic resource probe; no environment files, providers or databases.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const originalFork = childProcess.fork;
const root = resolve('data'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'parser-resource-'));
let peak = 0;
try {
  const preload = join(directory, 'resource.cjs');
  writeFileSync(preload, `const send=process.send.bind(process);process.send=(message,...args)=>send({...message,fixturePeakRssKiB:process.resourceUsage().maxRSS},...args);`);
  childProcess.fork = (file, args, options) => {
    const child = originalFork(file, args, { ...options, execArgv: [...options.execArgv, '--require', preload] });
    child.on('message', message => { peak = Math.max(peak, Number(message.fixturePeakRssKiB) || 0); });
    return child;
  };
  process.env.PARSER_ISOLATION = 'process';
  const { extractDocument } = require('../dist/src/rag/document-parser.js');
  const text = 'Synthetic maximum length document. '.repeat(16000).slice(0, 500000).trimEnd();
  // Preserve exactly the supported extracted character limit, with no trailing space trimmed by parsing.
  const buffer = Buffer.from(text.padEnd(500000, 'x'));
  const start = performance.now();
  const parsed = await extractDocument({ originalname: 'maximum.txt', buffer, size: buffer.length });
  assert.equal(parsed.length, 500000); assert.ok(peak > 0 && peak < 256 * 1024);
  const result = { inputBytes: buffer.length, extractedCharacters: parsed.length, parserPeakRssKiB: peak,
    parentPeakRssKiB: process.resourceUsage().maxRSS, elapsedMs: performance.now() - start,
    parserHeapCapMiB: 96, declaredParserBudgetMiB: 256, format: 'txt', concurrency: 1,
    limitation: 'Single synthetic maximum-text fixture; not PDF/DOCX worst-case or concurrent capacity.' };
  writeFileSync(resolve(process.argv[2] || 'data/m3b-parser-resources.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  childProcess.fork = originalFork;
  // Only this probe's freshly created, workspace-local directory is removed.
  assert.ok(directory.startsWith(root + '\\') || directory.startsWith(root + '/'));
  rmSync(directory, { recursive: true, force: true });
}
