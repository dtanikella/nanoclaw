import fs from 'fs';

const SERVICE_ACCOUNT_PATH = '/workspace/agent/service-account.json';

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
  const { google } = await import('googleapis');
  const keyFile = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}
