// TypeScript, loaded the way Node loads CommonJS. Importing the compiler's
// CommonJS bundle directly from an ES module keeps ~18 MB more resident (Node
// scans the 9 MB source for named exports); this re-export avoids that, and a
// literal require() keeps bundlers (ClawHub's Convex actions) including it.
// Modules that import it are themselves loaded on demand (see inspector.js,
// openclaw-target.js and registry-deprecations.js), so publish-time source
// scanning runs without the compiler resident.
module.exports = require("typescript");
