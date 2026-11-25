import { create } from 'zustand';

interface T {
  msg: string | null;
  kind: 'info' | 'error';
  show: (m: string, kind?: 'info' | 'error', ms?: number) => void;
}
let timer: ReturnType<typeof setTimeout> | undefined;
export const useToast = create<T>((set) => ({
  msg: null,
  kind: 'info',
  show: (msg, kind = 'info', ms = 2600) => {
    clearTimeout(timer);
    set({ msg, kind });
    timer = setTimeout(() => set({ msg: null }), ms);
  },
}));
export const toast = (m: string, kind?: 'info' | 'error', ms?: number) => useToast.getState().show(m, kind, ms);

export function ToastHost() {
  const { msg, kind } = useToast();
  if (!msg) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className={`max-w-md rounded-xl px-4 py-3 text-sm shadow-xl ${kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-900'}`}>{msg}</div>
    </div>
  );
}
