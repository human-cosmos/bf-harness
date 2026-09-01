import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 4318,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4318,
    strictPort: true,
    allowedHosts: true,
  },
});
