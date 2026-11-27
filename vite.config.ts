import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, globPatterns: ['**/*.{js,css,html,png,svg}'] },
      manifest: {
        name: 'Choo-Choo Builder',
        short_name: 'Choo-Choo',
        description: 'Build train tracks and assemble the train!',
        theme_color: '#7cc85a',
        background_color: '#7cc85a',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
});
