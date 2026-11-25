import { create } from 'zustand';
import type { Candidate, ImportItem } from '../pipeline/types';
import type { Stage } from '../pipeline/process';
import type { TitleRoi } from '../types';

export interface RoiRequest {
  frameUrl: string;
  width: number;
  height: number;
  resolve: (r: TitleRoi | null) => void;
}

interface S {
  items: ImportItem[];
  multiSong: boolean;
  songCount: number | null;
  targetSessionId: string | null;
  running: boolean;
  stage: Stage | null;
  ratio: number;
  label: string;
  logs: string[];
  errors: string[];
  candidates: Candidate[];
  roiRequest: RoiRequest | null;
  abort: AbortController | null;
  startedAt: number;
  finishedAt: number;
  setRequest: (p: { items: ImportItem[]; multiSong: boolean; songCount: number | null; targetSessionId: string | null }) => void;
  set: (p: Partial<S>) => void;
  log: (m: string) => void;
  reset: () => void;
}

const initial = {
  items: [] as ImportItem[],
  multiSong: true,
  songCount: null as number | null,
  targetSessionId: null as string | null,
  running: false,
  stage: null as Stage | null,
  ratio: 0,
  label: '',
  logs: [] as string[],
  errors: [] as string[],
  candidates: [] as Candidate[],
  roiRequest: null as RoiRequest | null,
  abort: null as AbortController | null,
  startedAt: 0,
  finishedAt: 0,
};

export const useImport = create<S>((set, get) => ({
  ...initial,
  setRequest: (p) => set({ ...initial, ...p }),
  set: (p) => set(p),
  log: (m) => {
    const t = get().startedAt ? ((performance.now() - get().startedAt) / 1000).toFixed(2) : '0.00';
    set({ logs: [...get().logs, `[${t}s] ${m}`] });
  },
  reset: () => {
    for (const c of get().candidates) if (c.kind === 'recording') for (const s of c.songs) if (s.thumbUrl) URL.revokeObjectURL(s.thumbUrl);
    get().abort?.abort();
    set({ ...initial });
  },
}));
