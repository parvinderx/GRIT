/**
 * Resolve hook: adds the "@/" alias and extensionless imports so project .ts
 * files run on Node's native TypeScript. Runs in the loader thread.
 */
import { pathToFileURL } from "node:url";
import { resolve as pathResolve } from "node:path";

const SRC = pathResolve(process.cwd(), "src");
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;

  if (spec.startsWith("@/")) {
    spec = pathToFileURL(pathResolve(SRC, spec.slice(2))).href;
  }

  const isLocal = spec.startsWith(".") || spec.startsWith("file:") || spec.startsWith("/");
  if (!isLocal) return nextResolve(spec, context);

  let lastErr;
  for (const ext of EXT_CANDIDATES) {
    try {
      return await nextResolve(spec + ext, context);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
