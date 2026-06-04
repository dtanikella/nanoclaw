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

  newsItems.sort((a, b) => b.date.localeCompare(a.date));

  if (newsItems.length === 0) {
    throw new Error(`No news found for ${ticker}`);
  }

  return { newsItems: newsItems.slice(0, 10) };
}

const ticker = requireTicker();
const cik = process.argv[3] || undefined;
await runScript(() => fetchNews(ticker, cik));
