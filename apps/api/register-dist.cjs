/**
 * Preloaded by the production scripts (`node -r ./register-dist.cjs dist/...`). `nest build` compiles the workspace
 * packages into dist/packages, but at runtime `@plandit/*` would still resolve to their TypeScript sources through
 * node_modules. This points those imports at the compiled copies, and lets the copies find the packages' own
 * dependencies (e.g. @prisma/adapter-pg lives in packages/database/node_modules, not here).
 */
const path = require("path");
const Module = require("module");

require("tsconfig-paths").register({
  baseUrl: path.join(__dirname, "dist"),
  paths: {
    "@plandit/database/*": ["packages/database/src/*"],
    "@plandit/shared/*": ["packages/shared/src/*"],
  },
});

const packageModules = ["database", "shared"].map((name) => path.join(__dirname, "../../packages", name, "node_modules"));
process.env.NODE_PATH = [...packageModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
