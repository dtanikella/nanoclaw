import fs from 'fs';
import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';

// Bypass the OneCLI HTTPS proxy for googleapis — service account auth requires
// dynamic JWT signing that the proxy can't handle. Direct connection is safe
// because the googleapis library manages its own token exchange.
process.env.NO_PROXY = [process.env.NO_PROXY, '*.googleapis.com', 'accounts.google.com']
  .filter(Boolean)
  .join(',');

const SERVICE_ACCOUNT_PATH = '/workspace/agent/service-account.json';

let cachedClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (!cachedClient) {
    const keyFile = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    cachedClient = google.sheets({ version: 'v4', auth });
  }
  return cachedClient;
}

/**
 * Format a row for the trip log sheet.
 * Columns: raw_content | url(s) | domain(s) | created_at
 */
export function formatRow(
  rawContent: string,
  urls: string[],
  domains: string[],
  now: Date = new Date(),
): string[] {
  return [
    rawContent,
    urls.join(', '),
    domains.join(', '),
    now.toISOString(),
  ];
}

/**
 * Append a row to a Google Sheet tab.
 * Uses a service account JSON key mounted into the container.
 */
export async function appendRow(
  sheetId: string,
  tabName: string,
  row: string[],
): Promise<void> {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}
