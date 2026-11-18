import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { playerHtmlPlugin } from "./src/plugins/playerHtmlPlugin";

export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
    playerHtmlPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  server: {
    port: 5173,
  },
  build: {
    outDir: "../view",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "js/player/player": path.resolve(__dirname, "src/player/index.ts"),
      },
      output: {
        chunkFileNames: "js/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});