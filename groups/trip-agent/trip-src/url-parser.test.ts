import { describe, test, expect } from 'bun:test';
import { extractUrls, extractDomains } from './url-parser.js';

describe('extractUrls', () => {
  test('extracts https URLs', () => {
    expect(extractUrls('Check out https://booking.com/hotel-123')).toEqual([
      'https://booking.com/hotel-123',
    ]);
  });

  test('extracts http URLs', () => {
    expect(extractUrls('Visit http://example.com/page')).toEqual([
      'http://example.com/page',
    ]);
  });

  test('extracts multiple URLs', () => {
    expect(
      extractUrls('Hotels: https://booking.com/h1 and flights: https://kayak.com/flights'),
    ).toEqual(['https://booking.com/h1', 'https://kayak.com/flights']);
  });

  test('extracts www. URLs without protocol', () => {
    expect(extractUrls('Check www.booking.com/hotel')).toEqual([
      'www.booking.com/hotel',
    ]);
  });

  test('returns empty array for no URLs', () => {
    expect(extractUrls('Just a regular message')).toEqual([]);
  });

  test('strips trailing punctuation', () => {
    expect(extractUrls('Visit https://example.com/page.')).toEqual([
      'https://example.com/page',
    ]);
    expect(extractUrls('See https://example.com/page, then go')).toEqual([
      'https://example.com/page',
    ]);
  });

  test('handles URLs in angle brackets', () => {
    expect(extractUrls('Link: <https://example.com/page>')).toEqual([
      'https://example.com/page',
    ]);
  });

  test('preserves balanced parentheses in URLs', () => {
    expect(
      extractUrls('Wiki: https://en.wikipedia.org/wiki/Cat_(disambiguation)'),
    ).toEqual(['https://en.wikipedia.org/wiki/Cat_(disambiguation)']);
  });
});

describe('extractDomains', () => {
  test('extracts domain from https URL', () => {
    expect(extractDomains(['https://booking.com/hotel-123'])).toEqual([
      'booking.com',
    ]);
  });

  test('strips www. prefix', () => {
    expect(extractDomains(['https://www.booking.com/hotel'])).toEqual([
      'booking.com',
    ]);
  });

  test('handles www. URL without protocol', () => {
    expect(extractDomains(['www.booking.com/hotel'])).toEqual([
      'booking.com',
    ]);
  });

  test('deduplicates domains', () => {
    expect(
      extractDomains([
        'https://booking.com/h1',
        'https://booking.com/h2',
        'https://kayak.com/f1',
      ]),
    ).toEqual(['booking.com', 'kayak.com']);
  });

  test('returns empty array for no URLs', () => {
    expect(extractDomains([])).toEqual([]);
  });
});
