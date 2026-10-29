import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { DatabaseService } from '../src/database/database.service';

/** Offline cutover: preserves users, files, vectors and history; requires an empty target. */
async function importSqlite() {
  const sourcePath = process.argv.find(arg => arg.startsWith('--from='))?.slice(7);
  if (!sourcePath || !process.env.DATABASE_URL) throw new Error('Use --from=<sqlite-file> and set DATABASE_URL for an EMPTY PostgreSQL database.');
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  const target = new DatabaseService();
  const tables = ['users', 'documents', 'chunks', 'settings', 'conversations', 'messages', 'recovery_codes', 'security_events'] as const;
  try {
    await target.initialize(true);
    source.exec('BEGIN');
    await target.transaction(async () => {
      await target.get('SELECT pg_advisory_xact_lock(742902)');
      for (const table of tables) {
        if (await target.get(`SELECT 1 FROM ${table} LIMIT 1`)) throw new Error('Target is not empty. Import stopped without changing it.');
      }
      for (const table of tables) {
        if (!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
          if (table === 'recovery_codes' || table === 'security_events') continue;
          throw new Error('Required source table is missing.');
        }
        const rows = source.prepare(`SELECT * FROM ${table}`).all();
        for (const row of rows) {
          const columns = Object.keys(row);
          const values = Object.values(row).map(value => value instanceof Uint8Array ? Buffer.from(value) : value);
          // Identifiers come only from the known local schema, never request input.
          if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('Unexpected source schema.');
          await target.run(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, ...values);
        }
        const count = Number((await target.get(`SELECT COUNT(*) AS count FROM ${table}`))!.count);
        if (count !== rows.length) throw new Error('Import row count mismatch.');
        console.log(`${table}: ${count} rows copied`);
      }
    });
    console.log('Import committed. Source untouched. All users must sign in again; sessions and rate counters were not copied.');
  } finally {
    source.close();
    await target.onModuleDestroy();
  }
}
importSqlite().catch(() => { console.error('Import failed. Verify the source schema, PostgreSQL connection, and empty target. No secrets or document contents were logged.'); process.exitCode = 1; });
