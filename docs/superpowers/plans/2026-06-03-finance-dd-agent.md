# Finance DD Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NanoClaw agent group that generates structured financial due diligence reports for US equities via `/dd TICKER`, outputting a Discord rich embed with data from FMP, SEC EDGAR, FRED, and Yahoo Finance.

**Architecture:** New agent group `finance-dd` with TypeScript fetch scripts in `groups/finance-dd/scripts/`. A single orchestrator (`fetch-all.ts`) calls 7 sub-scripts and merges results into one JSON object. Claude fills a `{{PLACEHOLDER}}` template with the data — no free-form generation. API keys are injected by the OneCLI credential proxy; scripts use plain `fetch()`.

**Tech Stack:** TypeScript (runs via `bun run` in container, `npx tsx` locally), plain `fetch()` API, OneCLI vault for FMP/FRED keys, NanoClaw agent group + ncl CLI for wiring.

**GitHub Issues:** #1 (parent), #8 (scaffold), #9 (scripts), #10 (E2E)

**Design Spec:** `docs/superpowers/specs/2026-06-03-finance-dd-agent-design.md`

---

## File Structure

```
groups/finance-dd/
├── CLAUDE.local.md              # Agent instructions (trigger, flow, error handling)
├── dd-template.md               # Embed layout with {{PLACEHOLDER}} markers
├── dd-prompt.md                 # Compilation prompt for how Claude fills the template
└── scripts/
    ├── lib/
    │   ├── http.ts              # Shared fetch wrapper with retry, error handling, User-Agent
    │   ├── types.ts             # Shared types: ScriptResult, ErrorResult, all per-script output shapes
    │   └── format.ts            # Number/date/currency formatting helpers
    ├── fetch-profile.ts         # Company overview (FMP profile)
    ├── fetch-financials.ts      # Revenue, income, margins, breakdowns (FMP income statement + SEC EDGAR XBRL)
    ├── fetch-valuation.ts       # P/E, P/S, PEG, EV/EBITDA, sector averages (FMP key-metrics + sector-pe)
    ├── fetch-regulatory.ts      # Recent SEC filings list (SEC EDGAR submissions API)
    ├── fetch-industry.ts        # Macro indicators + sector performance (FRED + FMP)
    ├── fetch-analysts.ts        # Analyst consensus + price targets (FMP)
    ├── fetch-news.ts            # Recent news + 8-K events (FMP news + SEC EDGAR)
    └── fetch-all.ts             # Orchestrator: calls all sub-scripts, merges JSON, handles errors
```

No new host-side code changes. The agent group is entirely self-contained in `groups/finance-dd/`.

---

## Phase 1 — Agent Group Scaffold (Issue #8)

### Task 1: Create directory structure and shared types

**Files:**
- Create: `groups/finance-dd/scripts/lib/types.ts`
- Create: `groups/finance-dd/scripts/lib/http.ts`
- Create: `groups/finance-dd/scripts/lib/format.ts`

These shared utilities are used by every fetch script. Create them first so all scripts import from the same place.

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p groups/finance-dd/scripts/lib
```

- [ ] **Step 2: Write `types.ts` — shared type definitions**

Create `groups/finance-dd/scripts/lib/types.ts`:

```typescript
// Result wrapper: every sub-script returns either data or an error
export type ScriptResult<T> = T | ErrorResult;

export interface ErrorResult {
  error: string;
  warning: true;
}

export function isError(result: unknown): result is ErrorResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    "warning" in result
  );
}

// --- Per-script output shapes ---

export interface ProfileData {
  companyName: string;
  ticker: string;
  sector: string;
  industry: string;
  marketCap: number;
  employees: number;
  description: string;
  cik: string;
  exchange: string;
  price: number;
  beta: number;
  website: string;
}

export interface FinancialsData {
  revenueTTM: number;
  netIncomeTTM: number;
  grossMargin: number;
  operatingMargin: number;
  revenueBreakdown: BreakdownItem[];
  expenseBreakdown: BreakdownItem[];
}

export interface BreakdownItem {
  label: string;
  value: number;
  percentage: number;
}

export interface ValuationData {
  peRatio: number | null;
  forwardPE: number | null;
  psRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  sectorPEAvg: number | null;
  sectorName: string;
}

export interface RegulatoryData {
  recentFilings: Filing[];
}

export interface Filing {
  form: string;
  filingDate: string;
  description: string;
  url: string;
}

export interface IndustryData {
  fredIndicators: FredIndicator[];
  sectorPerformance: string;
  riskFactors: string[];
}

export interface FredIndicator {
  name: string;
  value: string;
  date: string;
}

export interface AnalystsData {
  priceTargetConsensus: number | null;
  priceTargetHigh: number | null;
  priceTargetLow: number | null;
  analystCount: number;
  buyCount: number;
  holdCount: number;
  sellCount: number;
}

export interface NewsData {
  newsItems: NewsItem[];
}

export interface NewsItem {
  title: string;
  date: string;
  source: string;
  url: string;
}

// The merged output from fetch-all.ts
export interface DDReport {
  profile: ScriptResult<ProfileData>;
  financials: ScriptResult<FinancialsData>;
  valuation: ScriptResult<ValuationData>;
  regulatory: ScriptResult<RegulatoryData>;
  industry: ScriptResult<IndustryData>;
  analysts: ScriptResult<AnalystsData>;
  news: ScriptResult<NewsData>;
}
```

- [ ] **Step 3: Write `http.ts` — shared fetch wrapper**

Create `groups/finance-dd/scripts/lib/http.ts`:

```typescript
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
```

- [ ] **Step 4: Write `format.ts` — formatting helpers**

Create `groups/finance-dd/scripts/lib/format.ts`:

```typescript
// Format large numbers: 1234567890 → "$1.23B"
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

// Format percentage: 0.461 → "46.1%"
export function formatPercent(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

// Format ratio: 28.4 → "28.4x" (already a ratio, not a decimal)
export function formatRatio(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return `${value.toFixed(1)}x`;
}

// Format large number without currency: 164000 → "164,000"
export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return value.toLocaleString("en-US");
}

// Format date: "2024-11-01" → "Nov 1, 2024"
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
```

- [ ] **Step 5: Commit shared utilities**

```bash
git add groups/finance-dd/scripts/lib/
git commit -m "feat(finance-dd): add shared utilities (types, http, format)

Shared TypeScript modules for the finance DD agent scripts:
- types.ts: all output shapes + error wrapper
- http.ts: fetch wrapper with retry, FMP/FRED/EDGAR URL builders
- format.ts: currency, percentage, ratio, number, date formatting

Part of #1, #9"
```

---

### Task 2: Write the DD template

**Files:**
- Create: `groups/finance-dd/dd-template.md`

The template contains the exact Discord embed layout with `{{PLACEHOLDER}}` markers that Claude fills with data from script output.

- [ ] **Step 1: Write `dd-template.md`**

Create `groups/finance-dd/dd-template.md`:

```markdown
📊 Due Diligence: {{COMPANY_NAME}} ({{TICKER}})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 Overview
{{SECTOR}} | {{MARKET_CAP}} Market Cap | {{EMPLOYEES}} employees
{{COMPANY_DESCRIPTION}}

💰 Financial Health
Revenue: {{REVENUE_TTM}} (TTM) | Net Income: {{NET_INCOME_TTM}}
Gross Margin: {{GROSS_MARGIN}} | Operating Margin: {{OPERATING_MARGIN}}

  Revenue Breakdown:
{{REVENUE_BREAKDOWN}}

  Expense Breakdown:
{{EXPENSE_BREAKDOWN}}

📐 Valuation
P/E: {{PE_RATIO}} (Sector avg: {{SECTOR_PE_AVG}}) | P/S: {{PS_RATIO}}
PEG: {{PEG_RATIO}} | EV/EBITDA: {{EV_EBITDA}}

⚖️ Regulatory
Recent filings: {{RECENT_FILINGS}}
{{ENFORCEMENT_STATUS}}

🏭 Industry Context
{{FRED_INDICATORS}}
Sector performance: {{SECTOR_PERFORMANCE}}
10-K risks: {{RISK_FACTORS}}

📊 Analyst Consensus
Price Target: {{PRICE_TARGET}} (consensus of {{ANALYST_COUNT}} analysts)
Buy: {{BUY_COUNT}} | Hold: {{HOLD_COUNT}} | Sell: {{SELL_COUNT}}

📰 Recent Catalysts
{{NEWS_ITEMS}}

Generated {{TIMESTAMP}} | Sources: FMP, EDGAR, FRED, Yahoo
```

- [ ] **Step 2: Commit template**

```bash
git add groups/finance-dd/dd-template.md
git commit -m "feat(finance-dd): add DD report template

Discord embed layout with {{PLACEHOLDER}} markers for all 7 report
sections. Claude fills these with data from fetch scripts.

Part of #1, #8"
```

---

### Task 3: Write the compilation prompt

**Files:**
- Create: `groups/finance-dd/dd-prompt.md`

This file tells Claude exactly how to fill the template with the fetched data.

- [ ] **Step 1: Write `dd-prompt.md`**

Create `groups/finance-dd/dd-prompt.md`:

```markdown
# DD Report Compilation Instructions

You have two inputs:
1. The JSON output from `fetch-all.ts` (the `data` object)
2. The template in `dd-template.md`

Your job: fill every `{{PLACEHOLDER}}` in the template with the corresponding data. Follow these rules exactly.

## Placeholder Mapping

| Placeholder | Source | Format |
|-------------|--------|--------|
| `{{COMPANY_NAME}}` | `data.profile.companyName` | As-is |
| `{{TICKER}}` | `data.profile.ticker` | Uppercase |
| `{{SECTOR}}` | `data.profile.sector` — `data.profile.industry` | "Sector — Industry" |
| `{{MARKET_CAP}}` | `data.profile.marketCap` | Abbreviated: $1.23T, $456.78B, $12.34M |
| `{{EMPLOYEES}}` | `data.profile.employees` | Comma-separated: 164,000 |
| `{{COMPANY_DESCRIPTION}}` | `data.profile.description` | Truncate to 200 characters + "..." if longer |
| `{{REVENUE_TTM}}` | `data.financials.revenueTTM` | Abbreviated currency |
| `{{NET_INCOME_TTM}}` | `data.financials.netIncomeTTM` | Abbreviated currency |
| `{{GROSS_MARGIN}}` | `data.financials.grossMargin` | Percentage: 46.1% |
| `{{OPERATING_MARGIN}}` | `data.financials.operatingMargin` | Percentage: 31.6% |
| `{{REVENUE_BREAKDOWN}}` | `data.financials.revenueBreakdown` | Bulleted list: "• Products: $200.58B (52.3%)" |
| `{{EXPENSE_BREAKDOWN}}` | `data.financials.expenseBreakdown` | Bulleted list: "• R&D: $31.37B (8.2%)" |
| `{{PE_RATIO}}` | `data.valuation.peRatio` | One decimal: 28.4x |
| `{{SECTOR_PE_AVG}}` | `data.valuation.sectorPEAvg` | One decimal: 25.1x |
| `{{PS_RATIO}}` | `data.valuation.psRatio` | One decimal: 7.2x |
| `{{PEG_RATIO}}` | `data.valuation.pegRatio` | One decimal: 2.1x |
| `{{EV_EBITDA}}` | `data.valuation.evToEbitda` | One decimal: 22.3x |
| `{{RECENT_FILINGS}}` | `data.regulatory.recentFilings` | Numbered list, max 5: "1. 10-K — Nov 1, 2024" |
| `{{ENFORCEMENT_STATUS}}` | Always | "ℹ️ Enforcement action screening not available in v1" |
| `{{FRED_INDICATORS}}` | `data.industry.fredIndicators` | Bulleted list: "• GDP Growth: 2.8% (Q3 2024)" |
| `{{SECTOR_PERFORMANCE}}` | `data.industry.sectorPerformance` | As-is |
| `{{RISK_FACTORS}}` | `data.industry.riskFactors` | Bulleted list, max 3 items, truncated to 100 chars each |
| `{{PRICE_TARGET}}` | `data.analysts.priceTargetConsensus` | Currency: $287.71 |
| `{{ANALYST_COUNT}}` | `data.analysts.analystCount` | Integer |
| `{{BUY_COUNT}}` | `data.analysts.buyCount` | Integer |
| `{{HOLD_COUNT}}` | `data.analysts.holdCount` | Integer |
| `{{SELL_COUNT}}` | `data.analysts.sellCount` | Integer |
| `{{NEWS_ITEMS}}` | `data.news.newsItems` | Numbered list, max 5: "1. [Title] — Source, Date" |
| `{{TIMESTAMP}}` | Current time | "Jun 3, 2026 10:30 PM EDT" |

## Error Handling

If any section's data has `{ "error": "...", "warning": true }` instead of real data, replace ALL placeholders in that section with:
```
⚠️ Data unavailable — [error message]
```

For example, if `data.valuation` has an error, the Valuation section becomes:
```
📐 Valuation
⚠️ Data unavailable — FMP API rate limit exceeded
```

## Rules

1. **Do not add commentary, opinions, or analysis.** You are a template filler, not an analyst.
2. **Do not use data from your training knowledge.** Only use data from the JSON output.
3. **Do not skip sections.** Every section must appear even if showing the error fallback.
4. **Keep the embed under 4000 characters.** Truncate descriptions and lists if needed.
5. **Use the exact emoji and formatting from the template.** Do not change the layout.
```

- [ ] **Step 2: Commit compilation prompt**

```bash
git add groups/finance-dd/dd-prompt.md
git commit -m "feat(finance-dd): add compilation prompt

Instructions for how Claude fills the DD template with fetched data.
Covers placeholder mapping, formatting rules, error handling, and
output constraints.

Part of #1, #8"
```

---

### Task 4: Write agent instructions (CLAUDE.local.md)

**Files:**
- Create: `groups/finance-dd/CLAUDE.local.md`

This file defines the agent's behavior: what it responds to, how it runs scripts, and how it delivers the report.

- [ ] **Step 1: Write `CLAUDE.local.md`**

Create `groups/finance-dd/CLAUDE.local.md`:

```markdown
# Finance DD Agent

You are a financial due diligence report generator. You respond ONLY to `/dd TICKER` commands.

## Trigger

- **Respond to:** Messages starting with `/dd ` followed by a ticker symbol (case-insensitive)
- **Ignore everything else:** For any message that is NOT a `/dd` command, reply exactly:
  > I only respond to `/dd TICKER` — e.g., `/dd AAPL`

## Command Parsing

- `/dd AAPL` → process ticker `AAPL`
- `/dd aapl` → process ticker `AAPL` (normalize to uppercase)
- `/dd AAPL MSFT` → process only `AAPL`, ignore the rest
- `/dd` (no ticker) → reply: "Usage: `/dd TICKER` — e.g., `/dd AAPL`"
- `/dd 123` or `/dd !!!` → invalid ticker, proceed and let the fetch script report "ticker not found"

## Execution Flow

### Phase 1 — Data Fetch

1. Send a progress message: `📊 Fetching data for TICKER...`
2. Run the orchestrator script:
   ```bash
   bun run /workspace/agent/scripts/fetch-all.ts TICKER
   ```
3. Capture the JSON output from stdout.

### Phase 2 — Report Compilation

4. Send a progress message: `📝 Compiling DD report for TICKER...`
5. Read two files:
   - `/workspace/agent/dd-template.md` — the embed layout
   - `/workspace/agent/dd-prompt.md` — compilation instructions
6. Follow the instructions in `dd-prompt.md` exactly to fill the template with the fetched data.
7. Send the completed report as a single message.

## Error Handling

- **Script exits non-zero with no JSON:** Reply "Unable to fetch data for TICKER. Please try again later."
- **Script returns JSON with some sections having `{ "error": "...", "warning": true }`:** Generate the report with error fallbacks as described in `dd-prompt.md`.
- **All sections have errors:** Reply "Unable to fetch data for TICKER. Please try again later."
- **Ticker not found (profile returns error):** Reply "Ticker TICKER not found. Please provide a valid US equity ticker."

## Rules

- Do NOT use your training data for financial information. Only use data from the scripts.
- Do NOT add opinions, buy/sell recommendations, or risk assessments.
- Do NOT engage in conversation. You are a single-purpose tool.
- Always read `dd-template.md` and `dd-prompt.md` fresh on every invocation (files may be updated).
```

- [ ] **Step 2: Commit agent instructions**

```bash
git add groups/finance-dd/CLAUDE.local.md
git commit -m "feat(finance-dd): add agent instructions (CLAUDE.local.md)

Defines trigger (/dd TICKER), two-phase execution flow, error handling,
and behavioral rules. Agent reads template + prompt fresh each time.

Part of #1, #8"
```

---

### Task 5: Create agent group and wire via ncl

**Prerequisite:** The NanoClaw host must be running. This task creates the agent group in the central DB and wires it to a messaging group.

**Note:** This task involves `ncl` CLI commands that modify the live database. The exact messaging group ID depends on which Discord channel the agent should be wired to. The operator must provide this.

- [ ] **Step 1: Create the agent group**

```bash
pnpm exec tsx src/cli/ncl.ts groups create --name "Finance DD" --folder finance-dd
```

Expected: JSON output with the new group's `id`. Save this — you'll need it for wiring.

- [ ] **Step 2: Verify the group was created**

```bash
pnpm exec tsx src/cli/ncl.ts groups list
```

Expected: `finance-dd` appears in the list.

- [ ] **Step 3: Wire to a messaging group**

Ask the operator which messaging group (Discord channel) this agent should be wired to. Then:

```bash
pnpm exec tsx src/cli/ncl.ts wirings create \
  --messaging-group-id <MESSAGING_GROUP_ID> \
  --agent-group-id <AGENT_GROUP_ID> \
  --engage-mode pattern \
  --engage-pattern "^/dd\b" \
  --ignored-message-policy accumulate \
  --session-mode shared
```

Key flags:
- `--engage-mode pattern` + `--engage-pattern "^/dd\b"`: Only triggers on messages starting with `/dd`
- `--ignored-message-policy accumulate`: Non-matching messages are buffered (not dropped), so the agent sees them and can reply with the usage hint
- `--session-mode shared`: Single shared session for all users in the channel

- [ ] **Step 4: Commit (nothing to commit — DB changes only)**

No file changes. The DB is modified by `ncl`. Proceed to Phase 2.

---

## Phase 2 — Data Fetching Scripts (Issue #9)

### Task 6: `fetch-profile.ts` — Company overview

**Files:**
- Create: `groups/finance-dd/scripts/fetch-profile.ts`

Fetches company profile from FMP. This is the simplest script and establishes the pattern all others follow.

- [ ] **Step 1: Write `fetch-profile.ts`**

Create `groups/finance-dd/scripts/fetch-profile.ts`:

```typescript
import { fetchJSON, fmpURL, requireTicker, runScript } from "./lib/http.ts";
import type { ProfileData } from "./lib/types.ts";

interface FMPProfile {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  fullTimeEmployees: string;
  description: string;
  cik: string;
  exchange: string;
  price: number;
  beta: number;
  website: string;
}

async function fetchProfile(ticker: string): Promise<ProfileData> {
  const url = fmpURL("/profile", { symbol: ticker });
  const data = await fetchJSON<FMPProfile[]>(url);

  if (!data || data.length === 0) {
    throw new Error(`Ticker ${ticker} not found`);
  }

  const p = data[0];
  return {
    companyName: p.companyName,
    ticker: p.symbol,
    sector: p.sector,
    industry: p.industry,
    marketCap: p.marketCap,
    employees: parseInt(p.fullTimeEmployees, 10) || 0,
    description: p.description,
    cik: p.cik,
    exchange: p.exchange,
    price: p.price,
    beta: p.beta,
    website: p.website,
  };
}

const ticker = requireTicker();
await runScript(() => fetchProfile(ticker));
```

- [ ] **Step 2: Verify it runs (requires FMP_API_KEY)**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-profile.ts AAPL | jq .
```

Expected: JSON with `companyName`, `ticker`, `sector`, `marketCap`, etc.

- [ ] **Step 3: Test invalid ticker**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-profile.ts XYZZY
```

Expected: Non-zero exit code, error message on stderr.

- [ ] **Step 4: Commit**

```bash
git add groups/finance-dd/scripts/fetch-profile.ts
git commit -m "feat(finance-dd): add fetch-profile script

Fetches company profile from FMP /stable/profile endpoint. Returns
company name, sector, market cap, employees, description, CIK.

Part of #1, #9"
```

---

### Task 7: `fetch-financials.ts` — Revenue, income, margins, breakdowns

**Files:**
- Create: `groups/finance-dd/scripts/fetch-financials.ts`

Fetches income statement from FMP for margins/totals, and SEC EDGAR XBRL for revenue/expense breakdowns.

- [ ] **Step 1: Write `fetch-financials.ts`**

Create `groups/finance-dd/scripts/fetch-financials.ts`:

```typescript
import { fetchJSON, fmpURL, edgarURL, requireTicker, runScript } from "./lib/http.ts";
import type { FinancialsData, BreakdownItem } from "./lib/types.ts";

interface FMPIncomeStatement {
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  researchAndDevelopmentExpenses: number;
  sellingGeneralAndAdministrativeExpenses: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  interestExpense: number;
  depreciationAndAmortization: number;
  period: string;
}

interface EDGARCompanyFacts {
  facts: {
    "us-gaap"?: Record<
      string,
      {
        units: Record<string, Array<{ val: number; fp: string; fy: number; form: string }>>;
      }
    >;
  };
}

function getLatestAnnualValue(
  facts: EDGARCompanyFacts["facts"]["us-gaap"],
  tag: string
): number | null {
  const concept = facts?.[tag];
  if (!concept) return null;
  const usdUnits = concept.units?.USD;
  if (!usdUnits) return null;
  const annuals = usdUnits
    .filter((u) => u.fp === "FY" && u.form === "10-K")
    .sort((a, b) => b.fy - a.fy);
  return annuals[0]?.val ?? null;
}

async function fetchFinancials(ticker: string, cik?: string): Promise<FinancialsData> {
  // 1. FMP income statement for TTM totals + margins
  const incomeUrl = fmpURL("/income-statement", {
    symbol: ticker,
    limit: "4",
    period: "annual",
  });
  const statements = await fetchJSON<FMPIncomeStatement[]>(incomeUrl);

  if (!statements || statements.length === 0) {
    throw new Error(`No financial data found for ${ticker}`);
  }

  const latest = statements[0];
  const revenue = latest.revenue;
  const grossMargin = revenue > 0 ? latest.grossProfit / revenue : 0;
  const operatingMargin = revenue > 0 ? latest.operatingIncome / revenue : 0;

  // 2. Build expense breakdown from FMP income statement fields
  const expenseBreakdown: BreakdownItem[] = [];
  const expenseItems: [string, number][] = [
    ["Cost of Revenue", latest.costOfRevenue],
    ["R&D", latest.researchAndDevelopmentExpenses],
    ["SG&A", latest.sellingGeneralAndAdministrativeExpenses],
    ["Interest Expense", latest.interestExpense],
    ["D&A", latest.depreciationAndAmortization],
  ];
  for (const [label, value] of expenseItems) {
    if (value && value > 0) {
      expenseBreakdown.push({
        label,
        value,
        percentage: revenue > 0 ? value / revenue : 0,
      });
    }
  }

  // 3. SEC EDGAR XBRL for revenue breakdown by segment (best-effort)
  let revenueBreakdown: BreakdownItem[] = [];
  if (cik) {
    try {
      const paddedCik = cik.padStart(10, "0");
      const edgarData = await fetchJSON<EDGARCompanyFacts>(
        edgarURL(`/api/xbrl/companyfacts/CIK${paddedCik}.json`)
      );
      // Try common segment revenue tags
      const segmentTags = [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromExternalCustomers",
        "SalesRevenueNet",
      ];
      // XBRL segment data is complex; for v1, just note total revenue from EDGAR
      const edgarRevenue = getLatestAnnualValue(edgarData.facts["us-gaap"], "Revenues") ??
        getLatestAnnualValue(edgarData.facts["us-gaap"], "RevenueFromContractWithCustomerExcludingAssessedTax");
      if (edgarRevenue) {
        revenueBreakdown.push({
          label: "Total Revenue (EDGAR cross-check)",
          value: edgarRevenue,
          percentage: 1.0,
        });
      }
    } catch {
      // EDGAR is best-effort; proceed without it
    }
  }

  // Fallback: if no EDGAR breakdown, use FMP revenue as single line
  if (revenueBreakdown.length === 0) {
    revenueBreakdown.push({
      label: "Total Revenue",
      value: revenue,
      percentage: 1.0,
    });
  }

  return {
    revenueTTM: revenue,
    netIncomeTTM: latest.netIncome,
    grossMargin,
    operatingMargin,
    revenueBreakdown,
    expenseBreakdown,
  };
}

const ticker = requireTicker();
// CIK is passed as optional second arg (from fetch-all.ts after profile is fetched)
const cik = process.argv[3] || undefined;
await runScript(() => fetchFinancials(ticker, cik));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-financials.ts AAPL 0000320193 | jq .
```

Expected: JSON with `revenueTTM`, `netIncomeTTM`, `grossMargin`, `operatingMargin`, `expenseBreakdown`.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-financials.ts
git commit -m "feat(finance-dd): add fetch-financials script

Fetches income statement from FMP + XBRL from SEC EDGAR. Returns TTM
revenue, net income, margins, expense breakdown by category. EDGAR
revenue breakdown is best-effort.

Part of #1, #9"
```

---

### Task 8: `fetch-valuation.ts` — Ratios and sector comparison

**Files:**
- Create: `groups/finance-dd/scripts/fetch-valuation.ts`

- [ ] **Step 1: Write `fetch-valuation.ts`**

Create `groups/finance-dd/scripts/fetch-valuation.ts`:

```typescript
import { fetchJSON, fmpURL, requireTicker, runScript } from "./lib/http.ts";
import type { ValuationData } from "./lib/types.ts";

interface FMPKeyMetrics {
  peRatioTTM: number;
  priceToSalesRatioTTM: number;
  evToEbitdaTTM: number;
}

interface FMPSectorPE {
  date: string;
  sector: string;
  exchange: string;
  pe: number;
}

async function fetchValuation(ticker: string, sector?: string, exchange?: string): Promise<ValuationData> {
  // 1. Key metrics TTM for P/E, P/S, EV/EBITDA
  const metricsUrl = fmpURL("/key-metrics-ttm", { symbol: ticker });
  const metrics = await fetchJSON<FMPKeyMetrics[]>(metricsUrl);

  if (!metrics || metrics.length === 0) {
    throw new Error(`No valuation data found for ${ticker}`);
  }

  const m = metrics[0];

  // 2. Sector PE for comparison (best-effort)
  let sectorPEAvg: number | null = null;
  const sectorName = sector || "Unknown";
  if (sector && exchange) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const sectorUrl = fmpURL("/sector-pe-snapshot", {
        exchange: exchange,
        date: today,
      });
      const sectorData = await fetchJSON<FMPSectorPE[]>(sectorUrl);
      const match = sectorData?.find(
        (s) => s.sector.toLowerCase() === sector.toLowerCase()
      );
      if (match) sectorPEAvg = match.pe;
    } catch {
      // Sector PE is best-effort
    }
  }

  // PEG ratio: P/E divided by expected earnings growth (not available from key-metrics-ttm directly)
  // Use FMP financial-growth endpoint for EPS growth
  let pegRatio: number | null = null;
  try {
    interface FMPGrowth { epsgrowth: number }
    const growthUrl = fmpURL("/income-statement-growth", { symbol: ticker, limit: "1" });
    const growth = await fetchJSON<FMPGrowth[]>(growthUrl);
    if (growth?.[0]?.epsgrowth && growth[0].epsgrowth > 0 && m.peRatioTTM) {
      pegRatio = m.peRatioTTM / (growth[0].epsgrowth * 100);
    }
  } catch {
    // PEG is best-effort
  }

  return {
    peRatio: m.peRatioTTM || null,
    forwardPE: null, // FMP key-metrics-ttm doesn't include forward P/E; omit for v1
    psRatio: m.priceToSalesRatioTTM || null,
    pegRatio,
    evToEbitda: m.evToEbitdaTTM || null,
    sectorPEAvg,
    sectorName,
  };
}

const ticker = requireTicker();
const sector = process.argv[3] || undefined;
const exchange = process.argv[4] || undefined;
await runScript(() => fetchValuation(ticker, sector, exchange));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-valuation.ts AAPL Technology NASDAQ | jq .
```

Expected: JSON with `peRatio`, `psRatio`, `evToEbitda`, `sectorPEAvg`.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-valuation.ts
git commit -m "feat(finance-dd): add fetch-valuation script

Fetches P/E, P/S, PEG, EV/EBITDA from FMP key-metrics-ttm. Sector PE
average from FMP sector-pe-snapshot for comparison. PEG computed from
income statement growth.

Part of #1, #9"
```

---

### Task 9: `fetch-regulatory.ts` — SEC filings list

**Files:**
- Create: `groups/finance-dd/scripts/fetch-regulatory.ts`

- [ ] **Step 1: Write `fetch-regulatory.ts`**

Create `groups/finance-dd/scripts/fetch-regulatory.ts`:

```typescript
import { fetchJSON, edgarURL, requireTicker, runScript } from "./lib/http.ts";
import type { RegulatoryData, Filing } from "./lib/types.ts";

interface EDGARSubmissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

async function fetchRegulatory(ticker: string, cik?: string): Promise<RegulatoryData> {
  if (!cik) {
    // Try to find CIK from the company tickers file
    const tickers = await fetchJSON<Record<string, { cik_str: number; ticker: string }>>(
      "https://www.sec.gov/files/company_tickers.json"
    );
    const match = Object.values(tickers).find(
      (t) => t.ticker.toUpperCase() === ticker.toUpperCase()
    );
    if (!match) throw new Error(`CIK not found for ticker ${ticker}`);
    cik = String(match.cik_str);
  }

  const paddedCik = cik.padStart(10, "0");
  const data = await fetchJSON<EDGARSubmissions>(
    edgarURL(`/submissions/CIK${paddedCik}.json`)
  );

  const recent = data.filings.recent;
  const targetForms = new Set(["10-K", "10-Q", "8-K"]);
  const filings: Filing[] = [];

  for (let i = 0; i < recent.form.length && filings.length < 10; i++) {
    if (!targetForms.has(recent.form[i])) continue;

    const accession = recent.accessionNumber[i].replace(/-/g, "");
    const accessionFormatted = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];

    filings.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      description: recent.primaryDocDescription[i] || recent.form[i],
      url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/` +
        `${accession}/${primaryDoc}`,
    });
  }

  return { recentFilings: filings };
}

const ticker = requireTicker();
const cik = process.argv[3] || undefined;
await runScript(() => fetchRegulatory(ticker, cik));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && npx tsx scripts/fetch-regulatory.ts AAPL 0000320193 | jq .
```

Expected: JSON with `recentFilings` array containing 10-K, 10-Q, 8-K entries.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-regulatory.ts
git commit -m "feat(finance-dd): add fetch-regulatory script

Fetches recent SEC filings (10-K, 10-Q, 8-K) from EDGAR submissions
API. CIK can be passed as arg or looked up from SEC company_tickers.json.

Part of #1, #9"
```

---

### Task 10: `fetch-industry.ts` — Macro indicators + sector performance

**Files:**
- Create: `groups/finance-dd/scripts/fetch-industry.ts`

- [ ] **Step 1: Write `fetch-industry.ts`**

Create `groups/finance-dd/scripts/fetch-industry.ts`:

```typescript
import {
  fetchJSON,
  fredURL,
  fmpURL,
  edgarURL,
  requireTicker,
  runScript,
} from "./lib/http.ts";
import type { IndustryData, FredIndicator } from "./lib/types.ts";

interface FREDObservations {
  observations: Array<{ date: string; value: string }>;
}

interface FMPSectorPerformance {
  sector: string;
  changesPercentage: string;
}

interface EDGARCompanyFacts {
  facts: {
    "us-gaap"?: Record<
      string,
      {
        units: Record<string, Array<{ val: number; fp: string; fy: number; form: string }>>;
      }
    >;
  };
}

async function fetchFredIndicator(
  seriesId: string,
  name: string
): Promise<FredIndicator | null> {
  try {
    const url = fredURL("/series/observations", {
      series_id: seriesId,
      sort_order: "desc",
      limit: "1",
    });
    const data = await fetchJSON<FREDObservations>(url);
    const obs = data.observations?.[0];
    if (!obs || obs.value === ".") return null;
    return { name, value: obs.value, date: obs.date };
  } catch {
    return null;
  }
}

async function fetchIndustry(
  ticker: string,
  sector?: string,
  cik?: string
): Promise<IndustryData> {
  // 1. FRED macro indicators
  const fredSeries: [string, string][] = [
    ["A191RL1Q225SBEA", "Real GDP Growth (SAAR)"],
    ["FEDFUNDS", "Fed Funds Rate"],
    ["CPIAUCSL", "CPI (All Urban)"],
    ["UNRATE", "Unemployment Rate"],
  ];

  const fredResults = await Promise.all(
    fredSeries.map(([id, name]) => fetchFredIndicator(id, name))
  );
  const fredIndicators = fredResults.filter((r): r is FredIndicator => r !== null);

  // 2. Sector stock performance (FMP)
  let sectorPerformance = "N/A";
  if (sector) {
    try {
      const url = fmpURL("/sectors-performance");
      const data = await fetchJSON<FMPSectorPerformance[]>(url);
      const match = data?.find(
        (s) => s.sector.toLowerCase() === sector.toLowerCase()
      );
      if (match) {
        sectorPerformance = `${sector}: ${match.changesPercentage}`;
      }
    } catch {
      // Sector performance is best-effort
    }
  }

  // 3. 10-K risk factors from EDGAR (best-effort, just filing existence)
  const riskFactors: string[] = [];
  if (cik) {
    try {
      const paddedCik = cik.padStart(10, "0");
      const data = await fetchJSON<EDGARCompanyFacts>(
        edgarURL(`/api/xbrl/companyfacts/CIK${paddedCik}.json`)
      );
      // Note: XBRL doesn't contain risk factor text. For v1, we indicate
      // the user should refer to the most recent 10-K for risk factors.
      riskFactors.push("See most recent 10-K filing for detailed risk factors");
    } catch {
      riskFactors.push("Risk factor data unavailable");
    }
  }

  return { fredIndicators, sectorPerformance, riskFactors };
}

const ticker = requireTicker();
const sector = process.argv[3] || undefined;
const cik = process.argv[4] || undefined;
await runScript(() => fetchIndustry(ticker, sector, cik));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && FRED_API_KEY=<key> FMP_API_KEY=<key> npx tsx scripts/fetch-industry.ts AAPL Technology 0000320193 | jq .
```

Expected: JSON with `fredIndicators` array, `sectorPerformance`, `riskFactors`.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-industry.ts
git commit -m "feat(finance-dd): add fetch-industry script

Fetches macro indicators from FRED (GDP growth, fed funds rate, CPI,
unemployment), sector stock performance from FMP, and risk factor
reference from SEC EDGAR.

Part of #1, #9"
```

---

### Task 11: `fetch-analysts.ts` — Analyst consensus

**Files:**
- Create: `groups/finance-dd/scripts/fetch-analysts.ts`

- [ ] **Step 1: Write `fetch-analysts.ts`**

Create `groups/finance-dd/scripts/fetch-analysts.ts`:

```typescript
import { fetchJSON, fmpURL, requireTicker, runScript } from "./lib/http.ts";
import type { AnalystsData } from "./lib/types.ts";

interface FMPPriceTarget {
  symbol: string;
  targetHigh: number;
  targetLow: number;
  targetConsensus: number;
  targetMedian: number;
}

interface FMPAnalystRecommendation {
  symbol: string;
  date: string;
  analystRatingsbuy: number;
  analystRatingsHold: number;
  analystRatingsSell: number;
  analystRatingsStrongBuy: number;
  analystRatingsStrongSell: number;
}

async function fetchAnalysts(ticker: string): Promise<AnalystsData> {
  // 1. Price target consensus
  const targetUrl = fmpURL("/price-target-consensus", { symbol: ticker });
  const targets = await fetchJSON<FMPPriceTarget[]>(targetUrl);

  // 2. Analyst recommendations (buy/hold/sell counts)
  let buyCount = 0, holdCount = 0, sellCount = 0, analystCount = 0;
  try {
    const recsUrl = fmpURL("/analyst-stock-recommendations", { symbol: ticker });
    const recs = await fetchJSON<FMPAnalystRecommendation[]>(recsUrl);
    if (recs && recs.length > 0) {
      const latest = recs[0]; // Most recent period
      buyCount = (latest.analystRatingsStrongBuy || 0) + (latest.analystRatingsbuy || 0);
      holdCount = latest.analystRatingsHold || 0;
      sellCount = (latest.analystRatingsSell || 0) + (latest.analystRatingsStrongSell || 0);
      analystCount = buyCount + holdCount + sellCount;
    }
  } catch {
    // Recommendations are best-effort
  }

  if (!targets || targets.length === 0) {
    return {
      priceTargetConsensus: null,
      priceTargetHigh: null,
      priceTargetLow: null,
      analystCount,
      buyCount,
      holdCount,
      sellCount,
    };
  }

  const t = targets[0];
  if (analystCount === 0) {
    // Estimate count from price target summary
    try {
      const summaryUrl = fmpURL("/price-target-summary", { symbol: ticker });
      const summary = await fetchJSON<Array<{ lastYearCount: number }>>(summaryUrl);
      if (summary?.[0]) analystCount = summary[0].lastYearCount || 0;
    } catch {
      // Count is best-effort
    }
  }

  return {
    priceTargetConsensus: t.targetConsensus,
    priceTargetHigh: t.targetHigh,
    priceTargetLow: t.targetLow,
    analystCount,
    buyCount,
    holdCount,
    sellCount,
  };
}

const ticker = requireTicker();
await runScript(() => fetchAnalysts(ticker));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-analysts.ts AAPL | jq .
```

Expected: JSON with `priceTargetConsensus`, `buyCount`, `holdCount`, `sellCount`.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-analysts.ts
git commit -m "feat(finance-dd): add fetch-analysts script

Fetches analyst price target consensus and buy/hold/sell counts from
FMP. Combines strong buy/sell into buy/sell totals.

Part of #1, #9"
```

---

### Task 12: `fetch-news.ts` — Recent news and 8-K events

**Files:**
- Create: `groups/finance-dd/scripts/fetch-news.ts`

- [ ] **Step 1: Write `fetch-news.ts`**

Create `groups/finance-dd/scripts/fetch-news.ts`:

```typescript
import { fetchJSON, fmpURL, edgarURL, requireTicker, runScript } from "./lib/http.ts";
import type { NewsData, NewsItem } from "./lib/types.ts";

interface FMPNewsArticle {
  symbol: string | null;
  publishedDate: string;
  title: string;
  site: string;
  url: string;
  text: string;
}

interface EDGARSubmissions {
  filings: {
    recent: {
      form: string[];
      filingDate: string[];
      primaryDocDescription: string[];
      accessionNumber: string[];
      primaryDocument: string[];
    };
  };
}

async function fetchNews(ticker: string, cik?: string): Promise<NewsData> {
  const newsItems: NewsItem[] = [];

  // 1. FMP stock news
  try {
    const newsUrl = fmpURL("/news/stock", { symbols: ticker, limit: "10" });
    const articles = await fetchJSON<FMPNewsArticle[]>(newsUrl);

    if (articles) {
      for (const a of articles.slice(0, 7)) {
        newsItems.push({
          title: a.title,
          date: a.publishedDate?.split("T")[0] || "Unknown",
          source: a.site || "Unknown",
          url: a.url,
        });
      }
    }
  } catch {
    // FMP news is best-effort
  }

  // 2. SEC EDGAR 8-K filings as material events
  if (cik) {
    try {
      const paddedCik = cik.padStart(10, "0");
      const data = await fetchJSON<EDGARSubmissions>(
        edgarURL(`/submissions/CIK${paddedCik}.json`)
      );
      const recent = data.filings.recent;
      let eightKCount = 0;
      for (let i = 0; i < recent.form.length && eightKCount < 3; i++) {
        if (recent.form[i] !== "8-K") continue;
        const accession = recent.accessionNumber[i].replace(/-/g, "");
        newsItems.push({
          title: recent.primaryDocDescription[i] || "8-K Material Event",
          date: recent.filingDate[i],
          source: "SEC EDGAR",
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/` +
            `${accession}/${recent.primaryDocument[i]}`,
        });
        eightKCount++;
      }
    } catch {
      // EDGAR 8-K is best-effort
    }
  }

  // Sort all items by date (newest first)
  newsItems.sort((a, b) => b.date.localeCompare(a.date));

  if (newsItems.length === 0) {
    throw new Error(`No news found for ${ticker}`);
  }

  return { newsItems: newsItems.slice(0, 10) };
}

const ticker = requireTicker();
const cik = process.argv[3] || undefined;
await runScript(() => fetchNews(ticker, cik));
```

- [ ] **Step 2: Verify it runs**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-news.ts AAPL 0000320193 | jq .
```

Expected: JSON with `newsItems` array containing FMP news + EDGAR 8-K entries, sorted by date.

- [ ] **Step 3: Commit**

```bash
git add groups/finance-dd/scripts/fetch-news.ts
git commit -m "feat(finance-dd): add fetch-news script

Fetches recent news from FMP stock news API and material events from
SEC EDGAR 8-K filings. Results merged and sorted by date.

Part of #1, #9"
```

---

### Task 13: `fetch-all.ts` — Orchestrator

**Files:**
- Create: `groups/finance-dd/scripts/fetch-all.ts`

This is the single script Claude calls. It runs all sub-scripts, passes data between them (e.g., CIK from profile to regulatory), and merges results.

- [ ] **Step 1: Write `fetch-all.ts`**

Create `groups/finance-dd/scripts/fetch-all.ts`:

```typescript
import { requireTicker } from "./lib/http.ts";
import { isError, type DDReport, type ErrorResult, type ProfileData } from "./lib/types.ts";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ScriptDef {
  key: keyof DDReport;
  file: string;
  args: (profile: ProfileData | null) => string[];
}

const scripts: ScriptDef[] = [
  {
    key: "profile",
    file: "fetch-profile.ts",
    args: () => [],
  },
  {
    key: "financials",
    file: "fetch-financials.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
  {
    key: "valuation",
    file: "fetch-valuation.ts",
    args: (p) => [p?.sector || "", p?.exchange || ""],
  },
  {
    key: "regulatory",
    file: "fetch-regulatory.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
  {
    key: "industry",
    file: "fetch-industry.ts",
    args: (p) => [p?.sector || "", p?.cik || ""],
  },
  {
    key: "analysts",
    file: "fetch-analysts.ts",
    args: () => [],
  },
  {
    key: "news",
    file: "fetch-news.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
];

function makeError(msg: string): ErrorResult {
  return { error: msg, warning: true };
}

async function runSubScript(
  file: string,
  ticker: string,
  extraArgs: string[]
): Promise<unknown> {
  const scriptPath = resolve(__dirname, file);
  const args = [scriptPath, ticker, ...extraArgs];

  // Use Bun.spawn if available (container), otherwise child_process (local)
  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn(["bun", "run", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Script exited with code ${exitCode}`);
    }
    return JSON.parse(stdout);
  } else {
    const { execFileSync } = await import("child_process");
    const result = execFileSync("npx", ["tsx", ...args], {
      encoding: "utf-8",
      env: process.env,
      timeout: 30000,
    });
    return JSON.parse(result);
  }
}

async function fetchAll(ticker: string): Promise<DDReport> {
  const report: Partial<DDReport> = {};

  // Phase 1: Fetch profile first (other scripts need CIK, sector, exchange)
  let profile: ProfileData | null = null;
  try {
    profile = (await runSubScript("fetch-profile.ts", ticker, [])) as ProfileData;
    report.profile = profile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.profile = makeError(msg);
    // If profile fails with "not found", it's likely an invalid ticker
    if (msg.toLowerCase().includes("not found")) {
      // Fill all other keys with the same error
      for (const s of scripts) {
        if (s.key !== "profile") report[s.key] = makeError(`Ticker ${ticker} not found`);
      }
      console.log(JSON.stringify(report));
      return report as DDReport;
    }
  }

  // Phase 2: Fetch remaining scripts in parallel
  const remaining = scripts.filter((s) => s.key !== "profile");
  const results = await Promise.allSettled(
    remaining.map(async (s) => {
      const extraArgs = s.args(profile);
      return { key: s.key, data: await runSubScript(s.file, ticker, extraArgs) };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      (report as any)[result.value.key] = result.value.data;
    } else {
      const key = remaining[results.indexOf(result)].key;
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      (report as any)[key] = makeError(msg);
    }
  }

  console.log(JSON.stringify(report));
  return report as DDReport;
}

const ticker = requireTicker();
await fetchAll(ticker);
```

- [ ] **Step 2: Verify it runs end-to-end**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> FRED_API_KEY=<key> npx tsx scripts/fetch-all.ts AAPL | jq .
```

Expected: JSON with all 7 keys (`profile`, `financials`, `valuation`, `regulatory`, `industry`, `analysts`, `news`) populated. Some may have `warning: true` if APIs are unavailable.

- [ ] **Step 3: Test invalid ticker**

```bash
cd groups/finance-dd && FMP_API_KEY=<key> npx tsx scripts/fetch-all.ts XYZZY | jq .
```

Expected: JSON where all keys contain `{ "error": "Ticker XYZZY not found", "warning": true }`.

- [ ] **Step 4: Commit**

```bash
git add groups/finance-dd/scripts/fetch-all.ts
git commit -m "feat(finance-dd): add fetch-all orchestrator

Runs all 7 sub-scripts, passes CIK/sector/exchange from profile to
downstream scripts. Profile fetched first, remainder in parallel.
Invalid ticker → all sections error. Partial failures → per-section
error with warning flag.

Part of #1, #9"
```

---

### Task 14: OneCLI vault secret setup

**Prerequisite:** OneCLI must be installed and running (`onecli --version`).

This task stores FMP and FRED API keys in the OneCLI vault so the credential proxy injects them into container requests.

- [ ] **Step 1: Add FMP API key to OneCLI vault**

```bash
onecli secrets create \
  --name "Financial Modeling Prep" \
  --host "financialmodelingprep.com" \
  --type api-key \
  --key "<FMP_API_KEY>"
```

If the CLI doesn't support `--type api-key` with query param injection, use the OneCLI web UI at `http://127.0.0.1:10254` to configure the secret with the host pattern `financialmodelingprep.com`.

- [ ] **Step 2: Add FRED API key to OneCLI vault**

```bash
onecli secrets create \
  --name "FRED API" \
  --host "api.stlouisfed.org" \
  --type api-key \
  --key "<FRED_API_KEY>"
```

- [ ] **Step 3: Assign secrets to the finance-dd agent**

```bash
# Find the agent (identifier matches the agent group id)
onecli agents list

# Either set to "all" mode:
onecli agents set-secret-mode --id <agent-id> --mode all

# Or assign specific secrets:
onecli secrets list
onecli agents set-secrets --id <agent-id> --secret-ids <fmp-id>,<fred-id>
```

- [ ] **Step 4: Verify from inside the container**

After the agent container has started (send any message to trigger it), verify credentials work:

```bash
# From inside the container (via agent bash tool):
curl -s "https://financialmodelingprep.com/stable/profile?symbol=AAPL" | head -c 200
```

If the proxy is working, this should return real profile data (not a 401).

**Note:** If the OneCLI proxy doesn't support query-param injection for FMP/FRED (which use `apikey` / `api_key` query params, not headers), you'll need to set `FMP_API_KEY` and `FRED_API_KEY` as container environment variables instead. Add them to the agent group's container config:

```bash
# Fallback: set env vars directly in container config if proxy can't inject query params
pnpm exec tsx src/cli/ncl.ts groups config update --id <group-id> --json '{
  "env": {
    "FMP_API_KEY": "<key>",
    "FRED_API_KEY": "<key>"
  }
}'
```

---

## Phase 3 — End-to-End Integration (Issue #10)

### Task 15: E2E verification

**Prerequisite:** All scripts committed, agent group created and wired, OneCLI secrets configured, host running.

This task verifies the full flow matches the acceptance tests in issue #10.

- [ ] **Step 1: Test full DD report (Issue #10, Acceptance Test 1)**

In the wired Discord channel, send:
```
/dd AAPL
```

**Expected behavior:**
1. Agent replies: `📊 Fetching data for AAPL...`
2. Agent replies: `📝 Compiling DD report for AAPL...`
3. Agent sends a single message with the filled template — all 7 sections populated with real data

**Verify:** All sections have real data (not "N/A" or error fallbacks for a major ticker like AAPL).

- [ ] **Step 2: Test partial failure (Issue #10, Acceptance Test 2)**

Temporarily break one API key or use a ticker with sparse data:
```
/dd TICKER_WITH_SPARSE_DATA
```

**Expected:** Report renders with `⚠️ Data unavailable` in affected section(s), other sections show real data.

- [ ] **Step 3: Test template editability (Issue #10, Acceptance Test 3)**

Edit `groups/finance-dd/dd-template.md` — change one emoji (e.g., `📊` → `🔍` in the title). Then send `/dd AAPL` again.

**Expected:** The new embed uses the changed emoji. No code changes or container restart needed.

- [ ] **Step 4: Test error cases (Issue #8, Acceptance Tests 1-2)**

| Input | Expected Response |
|-------|-------------------|
| `/dd XYZZY` | "Ticker XYZZY not found. Please provide a valid US equity ticker." |
| `/dd` | "Usage: `/dd TICKER` — e.g., `/dd AAPL`" |
| `hello` | "I only respond to `/dd TICKER` — e.g., `/dd AAPL`" |

- [ ] **Step 5: Final commit with any fixes**

If any adjustments were needed during E2E testing, commit them:

```bash
git add -A groups/finance-dd/
git commit -m "fix(finance-dd): E2E integration fixes

Adjustments from end-to-end testing in Discord.

Part of #1, #10"
```

---

## Summary

| Phase | Issue | Tasks | Deliverables |
|-------|-------|-------|-------------|
| 1 — Scaffold | #8 | 1-5 | Shared libs, template, prompt, CLAUDE.local.md, ncl wiring |
| 2 — Scripts | #9 | 6-14 | 7 fetch scripts + orchestrator + OneCLI secrets |
| 3 — E2E | #10 | 15 | Full flow verification, error handling, template editability |

**Total API calls per DD report:** ~12-15 FMP + 2-3 EDGAR + 4 FRED = ~20 calls. Well within free-tier limits for FMP (250/day → ~16 reports/day).
