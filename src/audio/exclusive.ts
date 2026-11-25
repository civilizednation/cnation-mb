/** 비교 재생(Web Audio)과 단순 플레이어(<audio>)가 동시에 소리 내지 않도록 서로 알린다 */
export type AudioOwner = 'compare' | 'simple';
const EVENT = 'cnation:audio-owner';

export function claimAudio(owner: AudioOwner) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: owner }));
}

export function onOtherAudio(me: AudioOwner, cb: () => void) {
  const h = (e: Event) => {
    if ((e as CustomEvent).detail !== me) cb();
  };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
