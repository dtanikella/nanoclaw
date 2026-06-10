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

  let revenueBreakdown: BreakdownItem[] = [];
  if (cik) {
    try {
      const paddedCik = cik.padStart(10, "0");
      const edgarData = await fetchJSON<EDGARCompanyFacts>(
        edgarURL(`/api/xbrl/companyfacts/CIK${paddedCik}.json`)
      );
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
      // EDGAR is best-effort
    }
  }

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
const cik = process.argv[3] || undefined;
await runScript(() => fetchFinancials(ticker, cik));
