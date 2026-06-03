#!/usr/bin/env tsx
/**
 * Restore DB config from config/db-config.sql on a fresh machine.
 * Run after: git clone, pnpm install, pnpm build
 * Usage: pnpm exec tsx scripts/restore-config.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { runMigrations } from '../src/db/migrations/index.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'v2.db');
const SEED_PATH = path.join(process.cwd(), 'config', 'db-config.sql');

function main() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error(`Seed not found: ${SEED_PATH}`);
    console.error('Run scripts/export-config.ts on your source machine first.');
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  runMigrations(db);

  const sql = fs.readFileSync(SEED_PATH, 'utf-8');
  // Disable FK checks during seed: some rows reference IDs that exist in the
  // live system (e.g. Discord channel IDs stored as agent_destinations) but
  // are not represented in the exported tables.
  db.pragma('foreign_keys = OFF');
  db.exec(sql);
  db.pragma('foreign_keys = ON');
  db.close();

  console.log('Config restored from config/db-config.sql\n');
  console.log('--- Remaining manual steps ---');
  console.log('1. Install and start OneCLI daemon; add Anthropic API key to vault');
  console.log('   onecli --help');
  console.log('2. Copy .env to this machine — needs: DISCORD_BOT_TOKEN, OBSIDIAN_API_KEY, ONECLI_URL, TZ');
  console.log('   (See .env.example for the full list of required variables)');
  console.log('3. Confirm Discord bot is invited to your server');
  console.log('4. Install group dependencies:');
  console.log('   cd groups/vault-agent && bun install && cd ../..');
  console.log('5. Build the host:');
  console.log('   pnpm run build');
  console.log('6. Build the agent container:');
  console.log('   ./container/build.sh');
  console.log('7. Start the service:');
  console.log('   launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist   # macOS');
  console.log('   systemctl --user start nanoclaw                            # Linux');
}

main();
