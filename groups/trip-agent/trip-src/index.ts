/**
 * Trip Agent — entry point.
 *
 * Script-only NanoClaw agent that logs Discord messages to a Google Sheet.
 * No LLM — reads config, runs the poll loop.
 */
import fs from 'fs';
import type { TripConfig } from './poll-loop.js';
import { runTripPollLoop } from './poll-loop.js';

const CONFIG_PATH = '/workspace/agent/trip-config.json';

function log(msg: string): void {
  console.error(`[trip-agent] ${msg}`);
}

function loadTripConfig(): TripConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!raw.sheetId) throw new Error('sheetId is required in trip-config.json');
    return {
      sheetId: raw.sheetId,
      tabName: raw.tabName || 'Sheet1',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Failed to load trip config from ${CONFIG_PATH}: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  log('Starting trip agent');
  const config = loadTripConfig();
  log(`Config loaded: sheetId=${config.sheetId}, tabName=${config.tabName}`);
  await runTripPollLoop(config);
}

main().catch((err) => {
  log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
