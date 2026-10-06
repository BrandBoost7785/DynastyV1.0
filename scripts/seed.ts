#!/usr/bin/env tsx
/**
 * Seed a local development SQLite store with one deterministic demo user/game.
 *
 * Production Supabase/PostgreSQL data is deliberately not seeded by this script:
 * applying production migrations and fixtures belongs to the managed Supabase
 * migration pipeline, with real credentials provided outside the repository.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getEnv } from '../src/config/env';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { extractMetadata } from '../src/persistence/serialize';
import { createNewGame } from '../src/sim/bootstrap';

async function main(): Promise<void> {
  const env = getEnv();
  if (env.dbDriver !== 'sqlite') {
    throw new Error('Refusing to seed a non-SQLite store. This script is dev/test only.');
  }

  mkdirSync(dirname(env.sqlitePath), { recursive: true });
  const store = new SqliteStore(env.sqlitePath);
  try {
    const userId = 'demo-user';
    const user = await store.createUser({
      id: userId,
      email: 'demo@example.test',
      displayName: 'Demo Founder',
      passwordHash: null,
      authProvider: 'local',
    });
    if (!user.ok && user.code !== 'duplicate') throw new Error(user.message);

    const { state } = createNewGame({ userId, playerName: 'Demo Founder', seed: 'demo-seed' });
    const save = await store.saveGame({ ...extractMetadata(state), state, reason: 'dev seed' }, null);
    if (!save.ok && save.code !== 'conflict') throw new Error(save.message);

    console.log(`Seeded ${env.sqlitePath} with demo user ${userId} and game ${state.gameId}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
