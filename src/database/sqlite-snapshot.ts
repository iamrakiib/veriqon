import { DatabaseSync, backup } from 'node:sqlite';
import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

export async function sqliteSnapshot(sourcePath: string, destinationPath: string) {
  if (resolve(sourcePath) === resolve(destinationPath)) throw new Error('Snapshot destination must differ from the source.');
  // Exclusive creation prevents overwriting an existing backup or live database.
  closeSync(openSync(destinationPath, 'wx', 0o600));
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, destinationPath); }
  finally { source.close(); }
  // A standalone snapshot must not need a writable WAL/SHM directory in a read-only mount.
  const snapshot = new DatabaseSync(destinationPath);
  try { snapshot.exec('PRAGMA journal_mode=DELETE'); }
  finally { snapshot.close(); }
}
