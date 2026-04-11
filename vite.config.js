import { defineConfig } from 'vite';

export default defineConfig({
  // Configure the build options if needed
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
    open: true,
  },
});
