export type SourceKind = 'recording' | 'file' | 'gdrive';

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  songIds: string[];
  rounds: Round[];
  bestSongId?: string;
  segmentPresets: SegmentPreset[];
}

export interface Song {
  id: string;
  sessionId: string;
  sourceKind: SourceKind;
  sourceName: string;
  rawTitle: string;
  title: string;
  displayTitle: string;
  ocrConfidence?: number;
  thumbnailBlobKey?: string;
  audioBlobKey: string;
  audioMime: string;
  startInBlobSec: number;
  endInBlobSec: number;
  durationSec: number;
  userOffsetSec: number;
  needsReview: boolean;
  peaks?: Float32Array;
  sizeBytes?: number;
}

export type RoundMode = 'full' | 'segment';
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface Round {
  id: string;
  mode: RoundMode;
  relStartSec?: number;
  relEndSec?: number;
  referenceSongId?: string;
  songOrder: string[];
  blind: boolean;
  ratings: Record<string, Rating | undefined>;
  startedAt: number;
  completedAt?: number;
  label?: string;
}

export interface SegmentPreset {
  id: string;
  label: string;
  relStartSec: number;
  relEndSec: number;
}

export interface TitleRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SilenceParams {
  windowMs: number;
  silenceDb: number;
  minGapSec: number;
  minSongSec: number;
  clickMaxMs: number;
  tailDb: number;
}

export interface AppSettings {
  silence: SilenceParams;
  gapSec: number;
  autoNext: boolean;
  blindDefault: boolean;
  artist: string;
  mp3Kbps: 128 | 192 | 256 | 320;
  mp3FadeMs: number;
  exportNoticeShown: boolean;
  /** 제목 인식(OCR) 언어 — Tesseract 언어 코드 */
  ocrLangs: OcrLang[];
}

export type OcrLang = 'kor' | 'eng' | 'chi_sim' | 'chi_tra';
export const OCR_LANGS: { code: OcrLang; label: string }[] = [
  { code: 'kor', label: '한국어' },
  { code: 'eng', label: '영어' },
  { code: 'chi_sim', label: '중국어 간체' },
  { code: 'chi_tra', label: '중국어 번체' },
];

export const DEFAULT_SILENCE: SilenceParams = {
  windowMs: 20,
  silenceDb: -50,
  minGapSec: 1.0,
  minSongSec: 30,
  clickMaxMs: 300,
  tailDb: -60,
};

export const DEFAULT_SETTINGS: AppSettings = {
  silence: DEFAULT_SILENCE,
  gapSec: 1.0,
  autoNext: false,
  blindDefault: false,
  artist: 'cnation',
  mp3Kbps: 256,
  mp3FadeMs: 10,
  exportNoticeShown: false,
  ocrLangs: ['kor', 'eng', 'chi_sim', 'chi_tra'],
};
