import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build-only config — Express is the single dev server. Vite runs in build
// mode (one-shot or --watch), emits to web/public/dist/, and Express serves
// the result as static files. Base stays at '/' so the HTML references
// /assets/... which matches Express's static mount on web/public/dist.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
  },
});
