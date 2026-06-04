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
  const targetUrl = fmpURL("/price-target-consensus", { symbol: ticker });
  const targets = await fetchJSON<FMPPriceTarget[]>(targetUrl);

  let buyCount = 0, holdCount = 0, sellCount = 0, analystCount = 0;
  try {
    const recsUrl = fmpURL("/analyst-stock-recommendations", { symbol: ticker });
    const recs = await fetchJSON<FMPAnalystRecommendation[]>(recsUrl);
    if (recs && recs.length > 0) {
      const latest = recs[0];
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
