import type { ExtractedAudio } from '../audio/extract';
import type { SourceKind } from '../types';

export interface RecSong {
  id: string;
  srcStartSec: number;
  srcEndSec: number;
  needsReview: boolean;
  rawTitle: string;
  title: string;
  ocrConfidence?: number;
  thumb?: Blob;
  thumbUrl?: string;
  startEdited: boolean;
  endEdited: boolean;
  enabled: boolean;
}

export interface RecordingCandidate {
  kind: 'recording';
  id: string;
  name: string;
  sourceKind: SourceKind;
  file: File;
  extracted: ExtractedAudio;
  samples8k: Float32Array;
  peaks: Float32Array;
  durationSec: number;
  songCount: number | null;
  songs: RecSong[];
  warnings: string[];
  timings: Record<string, number>;
}

export interface FileCandidate {
  kind: 'file';
  id: string;
  name: string;
  sourceKind: SourceKind;
  blob: Blob;
  mime: string;
  startSec: number;
  endSec: number;
  totalSec: number;
  sampleRate: number;
  peaks: Float32Array;
  rawTitle: string;
  title: string;
  enabled: boolean;
  timings: Record<string, number>;
}

export type Candidate = RecordingCandidate | FileCandidate;

export interface ImportItem {
  file: File;
  sourceKind: SourceKind;
}
