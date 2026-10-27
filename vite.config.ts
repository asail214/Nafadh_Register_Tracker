import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // exceljs (~930 kB) is a separate chunk loaded only when an admin clicks "تصدير Excel"
  build: { chunkSizeWarningLimit: 1000 },
});
