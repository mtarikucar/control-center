import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const office = 'http://127.0.0.1:4319';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    // changeOrigin rewrites Host to the office's own, which its DNS-rebinding guard requires; Origin is kept, so
    // office-server must list this dev server in OFFICE_ALLOWED_ORIGINS (see README).
    proxy: {
      '/api': { target: office, changeOrigin: true },
      '/assets3d': { target: office, changeOrigin: true },
      '/ws': { target: office, ws: true, changeOrigin: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
