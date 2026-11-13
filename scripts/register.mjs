// Registers the resolve hook (hooks.mjs) for Node's module loader.
// Used by db:* / test:* npm scripts via `node --import ./scripts/register.mjs`.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
