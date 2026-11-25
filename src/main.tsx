import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './app/App';
import { initInstallCapture } from './install';
import { initAudioSession, kickAudio } from './audio/decode';
import { restorePlaylist } from './audio/simplePlayer';
import './index.css';

initInstallCapture();
initAudioSession();
restorePlaylist();
// iOS: 오디오가 멈춰 있으면(suspended/interrupted) 어떤 탭이든 그 안에서 바로 깨운다
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown'] as const) {
  document.addEventListener(ev, kickAudio, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') kickAudio();
});
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
