import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const office = 'http://127.0.0.1:4319';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api': office, '/assets3d': office, '/ws': { target: office, ws: true } },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
