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
