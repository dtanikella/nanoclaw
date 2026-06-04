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
  const metricsUrl = fmpURL("/key-metrics-ttm", { symbol: ticker });
  const metrics = await fetchJSON<FMPKeyMetrics[]>(metricsUrl);

  if (!metrics || metrics.length === 0) {
    throw new Error(`No valuation data found for ${ticker}`);
  }

  const m = metrics[0];

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
    forwardPE: null,
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
