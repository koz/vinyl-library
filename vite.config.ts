import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), mode !== 'test' && nitro(), viteReact()],
}))
