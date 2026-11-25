import { create } from 'zustand';
import { DEFAULT_SETTINGS, type AppSettings, type TitleRoi } from '../types';

const KEY = 'cnation-mb:settings';
const ROI_KEY = 'cnation-mb:titleRoi';

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...v, silence: { ...DEFAULT_SETTINGS.silence, ...(v.silence ?? {}) } };
    }
  } catch {
    /* noop */
  }
  return DEFAULT_SETTINGS;
}

export function loadRoi(): TitleRoi | null {
  try {
    const raw = localStorage.getItem(ROI_KEY);
    return raw ? (JSON.parse(raw) as TitleRoi) : null;
  } catch {
    return null;
  }
}

export function saveRoi(r: TitleRoi | null) {
  try {
    if (r) localStorage.setItem(ROI_KEY, JSON.stringify(r));
    else localStorage.removeItem(ROI_KEY);
  } catch {
    /* noop */
  }
}

interface S {
  settings: AppSettings;
  roi: TitleRoi | null;
  update: (p: Partial<AppSettings>) => void;
  setRoi: (r: TitleRoi | null) => void;
  reset: () => void;
}

export const useSettings = create<S>((set, get) => ({
  settings: load(),
  roi: loadRoi(),
  update: (p) => {
    const settings = { ...get().settings, ...p };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* noop */
    }
    set({ settings });
  },
  setRoi: (r) => {
    saveRoi(r);
    set({ roi: r });
  },
  reset: () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {
      /* noop */
    }
    set({ settings: DEFAULT_SETTINGS });
  },
}));
