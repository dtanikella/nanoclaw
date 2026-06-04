# Finance DD Agent — Design Spec

**Date:** 2026-06-03
**GitHub Issue:** #1
**Status:** Draft

## Overview

A NanoClaw agent that generates structured financial due diligence reports for US equities. Triggered by `/dd TICKER` in any Discord channel the agent is wired to. Output is a single Discord rich embed (~4K chars) with data sourced from public APIs — no LLM-generated opinions or training-knowledge-based analysis.

## Scope

- **In scope:** US equities (NYSE/NASDAQ) only
- **Out of scope (v1):** International stocks, crypto, multiple tickers per request, editorial/scoring, web search, news APIs beyond FMP

## Architecture

### Agent Group

- New agent group: `finance-dd`
- Folder: `groups/finance-dd/`
- Contains: `CLAUDE.md`, `scripts/`, `dd-template.md`
- Wired to any messaging group where DD is needed

### Approach: Shell Scripts

Data fetching is handled by TypeScript scripts (`tsx`) in `groups/finance-dd/scripts/`. Each script:
- Takes a ticker symbol as its single argument
- Outputs structured JSON to stdout
- Exits non-zero on failure with an error message on stderr
- Makes HTTP calls through the OneCLI credential proxy (keys injected transparently)

Claude's role is limited to filling a template with script output data. No free-form generation for the report itself.

## Data Sources & Scripts

| Script | Sources | Data Produced |
|--------|---------|---------------|
| `fetch-profile.ts` | Yahoo Finance, FMP | Company name, description, sector, industry, market cap, employees |
| `fetch-financials.ts` | FMP, SEC EDGAR XBRL | Revenue, net income, gross/operating margins, debt/equity, current ratio (TTM + last 4 quarters) |
| `fetch-valuation.ts` | FMP, Yahoo Finance | P/E, forward P/E, P/S, PEG, EV/EBITDA, sector averages for comparison |
| `fetch-regulatory.ts` | SEC EDGAR | Recent 10-K, 10-Q, 8-K filings list. Web scraping of enforcement actions page is excluded for v1 but can be added later. |
| `fetch-industry.ts` | FRED, FMP | Sector macro indicators (GDP by industry, PPI), sector stock performance |
| `fetch-analysts.ts` | FMP | Consensus price target, buy/hold/sell counts, EPS estimates |
| `fetch-news.ts` | FMP, SEC EDGAR 8-K | Recent news headlines, material events from 8-K filings |

### API Key Requirements

| Secret | Host Pattern | Notes |
|--------|-------------|-------|
| FMP API key | `financialmodelingprep.com` | Free tier: 250 calls/day |
| FRED API key | `api.stlouisfed.org` | Free, requires registration |

Yahoo Finance (unofficial) and SEC EDGAR APIs are free and keyless.

All secrets stored in OneCLI vault. The credential proxy injects keys into outbound requests matching host patterns — scripts use plain `fetch()` calls.

## Trigger & Flow

### Trigger

- Command: `/dd TICKER` (case-insensitive) in any channel the agent is wired to
- The agent ignores all messages that don't match this pattern, replying briefly: *"I only respond to `/dd TICKER`"*

### Two-Phase Execution

**Phase 1 — Data Fetch:**
1. Agent validates the ticker format
2. Agent sends progress message: *"📊 Fetching data for AAPL..."*
3. Agent runs scripts sequentially:
   - `fetch-profile.ts AAPL`
   - `fetch-financials.ts AAPL`
   - `fetch-valuation.ts AAPL`
   - `fetch-regulatory.ts AAPL`
   - `fetch-industry.ts AAPL`
   - `fetch-analysts.ts AAPL`
   - `fetch-news.ts AAPL`
4. Collects all JSON outputs

**Phase 2 — Report Compilation:**
5. Agent sends progress message: *"📝 Compiling DD report for AAPL..."*
6. Agent reads `dd-template.md` and fills `{{PLACEHOLDER}}` values with data from script outputs
7. Agent sends the final Discord rich embed

### Response Time

Up to 60 seconds is acceptable. The two progress messages keep the user informed during the wait.

## Template

The file `groups/finance-dd/dd-template.md` contains the exact embed layout:

```
📊 Due Diligence: {{COMPANY_NAME}} ({{TICKER}})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 Overview
{{SECTOR}} | {{MARKET_CAP}} Market Cap | {{EMPLOYEES}} employees
{{COMPANY_DESCRIPTION}}

💰 Financial Health
Revenue: {{REVENUE_TTM}} (TTM) | Net Income: {{NET_INCOME_TTM}}
Gross Margin: {{GROSS_MARGIN}} | Operating Margin: {{OPERATING_MARGIN}}
Debt/Equity: {{DEBT_EQUITY}} | Current Ratio: {{CURRENT_RATIO}}

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

CLAUDE.md instructs: *"Fill the template exactly. Do not add, remove, rearrange, or rephrase any section. Only replace `{{PLACEHOLDER}}` values with data from the script outputs."*

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid ticker (e.g., `/dd XYZZY`) | `fetch-profile.ts` returns error → agent replies *"Ticker XYZZY not found. Please provide a valid US equity ticker."* |
| API rate limit hit | Script retries once after 2s delay, then returns partial data with `warning` flag in JSON |
| One data source fails, others succeed | Report renders with *"⚠️ Data unavailable"* in that section; rest of report still generated |
| All data sources fail | Agent replies *"Unable to fetch data for TICKER. Please try again later."* |
| No ticker provided (`/dd`) | Agent replies *"Usage: `/dd TICKER` — e.g., `/dd AAPL`"* |
| Multiple tickers (`/dd AAPL MSFT`) | Process only the first ticker; ignore the rest (v1 simplicity) |

## Future Enhancements (Out of Scope for v1)

- Multiple tickers in one request
- International equities / crypto support
- Web scraping for regulatory enforcement actions
- Web search / news API integration
- Bull/bear summary or scoring
- Sharing to a community Discord server
- Caching recent DD reports to avoid redundant API calls
- PDF export
