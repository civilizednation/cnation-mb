import { describe, it, expect } from 'vitest';
import { computeDisplayTitles, cleanOcrTitle, titleFromFileName, safeFileName, uniqueFileNames } from '../src/ocr/titles';

describe('computeDisplayTitles', () => {
  it('numbers duplicates in play order', () => {
    expect(computeDisplayTitles(['Love', 'Rain', 'love ', 'Sky'])).toEqual(['Love 1', 'Rain', 'love 2', 'Sky']);
  });
  it('fills empty titles', () => {
    expect(computeDisplayTitles(['', 'A'])).toEqual(['곡 1', 'A']);
  });
  it('collapses whitespace', () => {
    expect(computeDisplayTitles(['A  B', 'a b'])).toEqual(['A B 1', 'a b 2']);
  });
});

describe('helpers', () => {
  it('cleans ocr', () => expect(cleanOcrTitle('  | 봄날의 노래 _ \n')).toBe('봄날의 노래'));
  it('file name', () => expect(titleFromFileName('dir/My Song.v2.mp3')).toBe('My Song.v2'));
  it('safe name', () => expect(safeFileName('a/b:c?')).toBe('a_b_c_'));
  it('unique names', () => expect(uniqueFileNames(['a.mp3', 'A.mp3', 'a.mp3'])).toEqual(['a.mp3', 'A (2).mp3', 'a (3).mp3']));
});
