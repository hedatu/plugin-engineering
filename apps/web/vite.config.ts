import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'PUBLIC_', 'SITE_'],
  server: {
    port: 5173,
  },
})
