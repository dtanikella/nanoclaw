#!/usr/bin/env tsx
/**
 * Export safe DB config tables to config/db-config.sql.
 * Run this after any ncl change to keep the committed baseline current.
 * Re-run: pnpm exec tsx scripts/export-config.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'v2.db');
const OUTPUT_PATH = path.join(process.cwd(), 'config', 'db-config.sql');

const EXPORT_TABLES = [
  'agent_groups',
  'container_configs',
  'messaging_groups',
  'messaging_group_agents',
  'agent_destinations',
  'user_roles',
] as const;

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function exportTable(db: Database.Database, table: string): string {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  if (rows.length === 0) return `-- ${table}: (empty)\n`;
  const lines = [`-- ${table}`];
  for (const row of rows) {
    const cols = Object.keys(row)
      .map((c) => `"${c}"`)
      .join(', ');
    const vals = Object.values(row).map(sqlLiteral).join(', ');
    lines.push(`INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${vals});`);
  }
  return lines.join('\n') + '\n';
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });

  const chunks: string[] = [
    '-- NanoClaw config export\n',
    `-- Generated: ${new Date().toISOString()}\n`,
    '-- Restore with: pnpm exec tsx scripts/restore-config.ts\n\n',
  ];

  for (const table of EXPORT_TABLES) {
    chunks.push(exportTable(db, table) + '\n');
  }

  db.close();

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, chunks.join(''));

  console.log(`Exported to ${OUTPUT_PATH}`);
  console.log('Verify: grep the output for real secret values — none should appear.');
}

main();
