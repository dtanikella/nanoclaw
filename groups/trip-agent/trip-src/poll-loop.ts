/**
 * Trip agent poll loop — processes messages without an LLM.
 *
 * Polls inbound.db, extracts URLs from messages, appends rows to
 * a Google Sheet, and writes a "✅ Logged" confirmation to outbound.db.
 *
 * Imports DB utilities from the shared agent-runner at /app/src/.
 */
import {
  getPendingMessages,
  markProcessing,
  markCompleted,
} from '/app/src/db/messages-in.js';
import { writeMessageOut } from '/app/src/db/messages-out.js';
import {
  touchHeartbeat,
  clearStaleProcessingAcks,
} from '/app/src/db/connection.js';
import { extractRouting } from '/app/src/formatter.js';
import { extractUrls, extractDomains } from './url-parser.js';
import { formatRow, appendRow } from './sheets.js';

const POLL_INTERVAL_MS = 1000;

export interface TripConfig {
  sheetId: string;
  tabName: string;
}

function log(msg: string): void {
  console.error(`[trip-agent] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseContent(json: string): { text?: string; sender?: string } {
  try {
    const parsed = JSON.parse(json);
    return {
      text: parsed.text || '',
      sender: parsed.sender || parsed.author?.fullName || parsed.author?.userName || 'Unknown',
    };
  } catch {
    return { text: json };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTripPollLoop(config: TripConfig): Promise<void> {
  log(`Starting trip agent (sheet: ${config.sheetId}, tab: ${config.tabName})`);

  clearStaleProcessingAcks();

  let pollCount = 0;
  let isFirstPoll = true;

  while (true) {
    const messages = getPendingMessages(isFirstPoll).filter(
      (m) => m.kind !== 'system',
    );
    isFirstPoll = false;
    pollCount++;

    if (pollCount % 30 === 0) {
      touchHeartbeat();
      log(`Poll heartbeat (${pollCount} iterations)`);
    }

    if (messages.length === 0) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Only process if there's at least one trigger message
    if (!messages.some((m) => m.trigger === 1)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const ids = messages.map((m) => m.id);
    markProcessing(ids);

    const routing = extractRouting(messages);

    for (const msg of messages) {
      const content = parseContent(msg.content);
      const text = content.text || '';

      // Skip empty messages
      if (!text.trim()) continue;

      const urls = extractUrls(text);
      const domains = extractDomains(urls);
      const row = formatRow(text, urls, domains);

      try {
        await appendRow(config.sheetId, config.tabName, row);
        log(`Logged message (${urls.length} URL(s)): ${text.slice(0, 80)}`);

        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: '✅ Logged' }),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`Error logging to sheet: ${errMsg}`);

        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({
            text: `❌ Failed to log: ${errMsg}`,
          }),
        });
      }
    }

    markCompleted(ids);
    touchHeartbeat();
  }
}
