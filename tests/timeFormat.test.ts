import { describe, it, expect } from 'vitest';
import { formatTime, parseTime } from '../src/utils/time';

describe('time', () => {
  it('formats', () => {
    expect(formatTime(45.24)).toBe('0:45.2');
    expect(formatTime(90)).toBe('1:30.0');
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(5, 0)).toBe('0:05');
  });
  it('parses', () => {
    expect(parseTime('0:45.2')).toBeCloseTo(45.2);
    expect(parseTime('1:30')).toBe(90);
    expect(parseTime('12.5')).toBe(12.5);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
