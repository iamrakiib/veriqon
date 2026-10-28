import { sqliteSnapshot } from '../src/database/sqlite-snapshot';

async function main() {
  const source = process.argv.find(arg => arg.startsWith('--from='))?.slice(7);
  const destination = process.argv.find(arg => arg.startsWith('--to='))?.slice(5);
  if (!source || !destination) throw new Error('Both source and a new destination are required.');
  await sqliteSnapshot(source, destination);
  console.log('Created a consistent standalone SQLite snapshot. Original database untouched.');
}
main().catch(() => { console.error('Snapshot failed. Check source access and use a new destination path with --from= and --to=.'); process.exitCode = 1; });
