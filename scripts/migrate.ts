import 'dotenv/config';
import { DatabaseService } from '../src/database/database.service';

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const database = new DatabaseService();
  try { await database.initialize(true); console.log('PostgreSQL migrations are current.'); }
  finally { await database.onModuleDestroy(); }
}
migrate().catch(() => { console.error('Migration failed. Check connectivity, extension privileges, and migration checksums. No connection secrets were logged.'); process.exitCode = 1; });
