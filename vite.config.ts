import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'cnation 음악 비교 분석',
        short_name: 'cnation-mb',
        description: '화면 녹화 영상/음악 파일로 곡을 자동 분리하고 비교·별점·MP3 저장',
        lang: 'ko',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['vendor/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // 자체 호스팅: Tesseract 워커/코어/언어 데이터, ffmpeg 코어 (최초 사용 시 다운로드 후 캐시)
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/vendor/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'vendor-runtime',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // (외부 CDN 사용 시) 캐시
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-runtime',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
