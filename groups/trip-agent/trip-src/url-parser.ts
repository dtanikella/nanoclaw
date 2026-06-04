const URL_PATTERN = /https?:\/\/[^\s<>"]+|(?:www\.)[^\s<>"]+/gi;
const TRAILING_PUNCT = /[.,;:!?\]}]+$/;

function stripTrailingPunctuation(url: string): string {
  let cleaned = url.replace(TRAILING_PUNCT, '');

  while (cleaned.endsWith(')')) {
    const openParens = (cleaned.match(/\(/g) ?? []).length;
    const closeParens = (cleaned.match(/\)/g) ?? []).length;

    if (closeParens <= openParens) break;
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

/**
 * Extract URLs from a message string.
 * Matches http://, https://, and www. prefixed URLs.
 * Strips trailing punctuation that's likely not part of the URL.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return matches.map(stripTrailingPunctuation);
}

/**
 * Extract unique domains from a list of URLs.
 * Strips www. prefix for cleanliness.
 */
export function extractDomains(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of urls) {
    try {
      const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
      let hostname = new URL(normalized).hostname;
      hostname = hostname.replace(/^www\./, '');
      if (!seen.has(hostname)) {
        seen.add(hostname);
        result.push(hostname);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return result;
}
