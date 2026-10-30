import { defineConfig } from "vite";
import { gui } from "@opencode/plugin/gui/vite";

// One CommonJS bundle for OpenCode Desktop: src/gui.tsx -> dist/gui-experimental.cjs
export default defineConfig({ plugins: [gui()] });
