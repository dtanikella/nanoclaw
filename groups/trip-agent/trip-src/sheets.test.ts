import { describe, test, expect } from 'bun:test';
import { formatRow } from './sheets.js';

describe('formatRow', () => {
  test('formats a message with URLs into a sheet row', () => {
    const row = formatRow(
      'Check out https://booking.com/hotel-123',
      ['https://booking.com/hotel-123'],
      ['booking.com'],
    );
    expect(row).toHaveLength(4);
    expect(row[0]).toBe('Check out https://booking.com/hotel-123');
    expect(row[1]).toBe('https://booking.com/hotel-123');
    expect(row[2]).toBe('booking.com');
    expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('formats a message with no URLs', () => {
    const row = formatRow('Just chatting', [], []);
    expect(row[0]).toBe('Just chatting');
    expect(row[1]).toBe('');
    expect(row[2]).toBe('');
    expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('comma-separates multiple URLs and domains', () => {
    const row = formatRow(
      'Two links',
      ['https://a.com/1', 'https://b.com/2'],
      ['a.com', 'b.com'],
    );
    expect(row[1]).toBe('https://a.com/1, https://b.com/2');
    expect(row[2]).toBe('a.com, b.com');
  });

  test('uses a provided timestamp when supplied', () => {
    const row = formatRow('Timed message', [], [], new Date('2025-01-01T00:00:00.000Z'));
    expect(row[3]).toBe('2025-01-01T00:00:00.000Z');
  });
});
