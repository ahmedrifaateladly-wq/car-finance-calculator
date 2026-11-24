import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is the GitHub Pages sub-path (/<repo>/). Relative assets keep the build portable.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
  test: { include: ['tests/**/*.test.ts', 'tests-private/**/*.test.ts'], environment: 'node' },
} as any);
