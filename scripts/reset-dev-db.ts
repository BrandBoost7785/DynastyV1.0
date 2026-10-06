#!/usr/bin/env tsx
/** Delete the local SQLite development database after an explicit confirmation. */
import { existsSync, rmSync } from 'node:fs';
import { getEnv } from '../src/config/env';

const env = getEnv();
if (env.dbDriver !== 'sqlite') {
  console.error('Refusing to reset a non-SQLite store. This script is dev/test only.');
  process.exit(1);
}
if (process.argv.includes('--yes') || process.env.DYNASTY_RESET_DEV_DB === 'yes') {
  if (existsSync(env.sqlitePath)) {
    rmSync(env.sqlitePath, { force: true });
    console.log(`Deleted ${env.sqlitePath}.`);
  } else {
    console.log(`${env.sqlitePath} did not exist.`);
  }
} else {
  console.error(`This will delete ${env.sqlitePath}. Re-run with --yes to confirm.`);
  process.exit(1);
}
