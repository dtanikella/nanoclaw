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
