import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and doesn't want Vite to clear its output.
export default defineConfig({ clearScreen: false, server: { port: 1420, strictPort: true } });
