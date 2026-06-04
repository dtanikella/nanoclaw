// Format large numbers: 1234567890 → "$1.23B"
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

// Format percentage: 0.461 → "46.1%"
export function formatPercent(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

// Format ratio: 28.4 → "28.4x" (already a ratio, not a decimal)
export function formatRatio(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return `${value.toFixed(1)}x`;
}

// Format large number without currency: 164000 → "164,000"
export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "N/A";
  return value.toLocaleString("en-US");
}

// Format date: "2024-11-01" → "Nov 1, 2024"
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
