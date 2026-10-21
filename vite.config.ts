import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Recharts da solo supera i 500 kB: soglia alzata, è già in un file separato.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Librerie grandi in file separati: caricamento e cache più efficienti.
        manualChunks: { charts: ['recharts'], react: ['react', 'react-dom'] },
      },
    },
  },
});
