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
