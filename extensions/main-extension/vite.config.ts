import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  envPrefix: ['VITE_', 'PUBLIC_', 'SITE_', 'PRODUCT_', 'FEATURE_', 'CHROME_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(rootDir, 'popup.html'),
        options: resolve(rootDir, 'options.html'),
        background: resolve(rootDir, 'src/background/index.ts'),
        content: resolve(rootDir, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
})
