// Builds the standalone Wi-Fi report viewer as ONE self-contained HTML file
// (all JS/CSS inlined, no network needed). The app's "Export report" button
// downloads it with the survey data embedded.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-report',
    emptyOutDir: true,
    rollupOptions: { input: 'report.html' },
  },
})
