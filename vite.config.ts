// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const envDir = path.dirname(fileURLToPath(import.meta.url));

/** Vite exposes only VITE_* to the browser. Server handlers read process.env, which does not load .env by itself. */
function loadProjectEnv(dir: string): Plugin {
  return {
    name: "hirehub-load-project-env",
    config(_userConfig, { mode }) {
      const loaded = loadEnv(mode, dir, "");
      for (const [key, value] of Object.entries(loaded)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [loadProjectEnv(envDir)],
    optimizeDeps: { include: ["sonner", "@radix-ui/react-dropdown-menu", "@radix-ui/react-dialog", "@radix-ui/react-avatar", "@radix-ui/react-label", "zod"] },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
