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

  const riskFactors: string[] = [];
  if (cik) {
    riskFactors.push("See most recent 10-K filing for detailed risk factors");
  } else {
    riskFactors.push("Risk factor data unavailable");
  }

  return { fredIndicators, sectorPerformance, riskFactors };
}

const ticker = requireTicker();
const sector = process.argv[3] || undefined;
const cik = process.argv[4] || undefined;
await runScript(() => fetchIndustry(ticker, sector, cik));
