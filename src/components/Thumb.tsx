import { useEffect, useState } from 'react';
import { Blobs } from '../db';

const cache = new Map<string, string>();

export function useBlobUrl(key?: string) {
  const [url, setUrl] = useState<string | undefined>(key ? cache.get(key) : undefined);
  useEffect(() => {
    let alive = true;
    if (!key) return setUrl(undefined);
    if (cache.has(key)) return setUrl(cache.get(key));
    Blobs.get(key).then((b) => {
      if (!b || !alive) return;
      const u = URL.createObjectURL(b);
      cache.set(key, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

export function Thumb({ blobKey, url, className = 'h-16 w-12', hidden = false }: { blobKey?: string; url?: string; className?: string; hidden?: boolean }) {
  const u = useBlobUrl(url ? undefined : blobKey);
  const src = url ?? u;
  return (
    <div className={`shrink-0 overflow-hidden rounded-lg bg-panel2 ${className}`}>
      {src && !hidden ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xl text-slate-600">{hidden ? '?' : '♪'}</div>
      )}
    </div>
  );
}
