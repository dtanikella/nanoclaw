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
