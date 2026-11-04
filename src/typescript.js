import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let typescript;

// Load the compiler on first use, through require(). Importing the CommonJS
// bundle as an ES module keeps ~20 MB more resident, and publish-time
// inspection should not hold ~50 MB of compiler while it scans plugin files
// that never need it. Modules that need TypeScript at load time are themselves
// imported lazily (see inspector.js and registry-deprecations.js).
export function loadTypeScript() {
  typescript ??= require("typescript");
  return typescript;
}
