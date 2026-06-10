import { requireTicker } from "./lib/http.ts";
import { type DDReport, type ErrorResult, type ProfileData } from "./lib/types.ts";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ScriptDef {
  key: keyof DDReport;
  file: string;
  args: (profile: ProfileData | null) => string[];
}

const scripts: ScriptDef[] = [
  {
    key: "profile",
    file: "fetch-profile.ts",
    args: () => [],
  },
  {
    key: "financials",
    file: "fetch-financials.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
  {
    key: "valuation",
    file: "fetch-valuation.ts",
    args: (p) => [p?.sector || "", p?.exchange || ""],
  },
  {
    key: "regulatory",
    file: "fetch-regulatory.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
  {
    key: "industry",
    file: "fetch-industry.ts",
    args: (p) => [p?.sector || "", p?.cik || ""],
  },
  {
    key: "analysts",
    file: "fetch-analysts.ts",
    args: () => [],
  },
  {
    key: "news",
    file: "fetch-news.ts",
    args: (p) => (p?.cik ? [p.cik] : []),
  },
];

function makeError(msg: string): ErrorResult {
  return { error: msg, warning: true };
}

async function runSubScript(
  file: string,
  ticker: string,
  extraArgs: string[]
): Promise<unknown> {
  const scriptPath = resolve(__dirname, file);
  const args = [scriptPath, ticker, ...extraArgs];

  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn(["bun", "run", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Script exited with code ${exitCode}`);
    }
    return JSON.parse(stdout);
  } else {
    const { execFileSync } = await import("child_process");
    const result = execFileSync("npx", ["tsx", ...args], {
      encoding: "utf-8",
      env: process.env,
      timeout: 30000,
    });
    return JSON.parse(result);
  }
}

async function fetchAll(ticker: string): Promise<void> {
  const report: Partial<DDReport> = {};

  // Phase 1: Fetch profile first (other scripts need CIK, sector, exchange)
  let profile: ProfileData | null = null;
  try {
    profile = (await runSubScript("fetch-profile.ts", ticker, [])) as ProfileData;
    report.profile = profile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.profile = makeError(msg);
    if (msg.toLowerCase().includes("not found")) {
      for (const s of scripts) {
        if (s.key !== "profile") report[s.key] = makeError(`Ticker ${ticker} not found`);
      }
      console.log(JSON.stringify(report));
      return;
    }
  }

  // Phase 2: Fetch remaining scripts in parallel
  const remaining = scripts.filter((s) => s.key !== "profile");
  const results = await Promise.allSettled(
    remaining.map(async (s) => {
      const extraArgs = s.args(profile);
      return { key: s.key, data: await runSubScript(s.file, ticker, extraArgs) };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const key = remaining[i].key;
    if (result.status === "fulfilled") {
      (report as any)[key] = result.value.data;
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      (report as any)[key] = makeError(msg);
    }
  }

  console.log(JSON.stringify(report));
}

const ticker = requireTicker();
await fetchAll(ticker);
