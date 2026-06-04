const USER_AGENT = "NanoClaw-FinanceDD/1.0 (github.com/dtanikella/nanoclaw)";

export interface FetchOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const defaults: Required<FetchOptions> = {
  retries: 1,
  retryDelayMs: 2000,
  timeoutMs: 15000,
};

export async function fetchJSON<T>(
  url: string,
  opts: FetchOptions = {}
): Promise<T> {
  const { retries, retryDelayMs, timeoutMs } = { ...defaults, ...opts };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelayMs);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError!;
}

// FMP endpoints require apikey as a query param.
// Inside the container, OneCLI proxy may inject it. Outside, use env var.
export function fmpURL(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://financialmodelingprep.com/stable${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const apiKey = process.env.FMP_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url.toString();
}

// FRED endpoints require api_key as a query param.
export function fredURL(
  path: string,
  params: Record<string, string> = {}
): string {
  const url = new URL(`https://api.stlouisfed.org/fred${path}`);
  url.searchParams.set("file_type", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

// SEC EDGAR requires descriptive User-Agent, no API key.
export function edgarURL(path: string): string {
  return `https://data.sec.gov${path}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Helper: read ticker from CLI args, exit if missing
export function requireTicker(): string {
  const ticker = process.argv[2]?.toUpperCase();
  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    console.error("Usage: <script> TICKER");
    process.exit(1);
  }
  return ticker;
}

// Helper: wrap a script's main function with error handling + JSON output
export async function runScript<T>(fn: () => Promise<T>): Promise<void> {
  try {
    const result = await fn();
    console.log(JSON.stringify(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
}
