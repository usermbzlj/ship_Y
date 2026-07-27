import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../node_modules/vinext/dist/cli-args.js";
import { loadDotenv } from "../node_modules/vinext/dist/config/dotenv.js";
import { StaticFileCache } from "../node_modules/vinext/dist/server/static-file-cache.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

loadDotenv({ root, mode: "production" });

// vinext 0.0.50 stores StaticFileCache keys with path.relative(). On Windows
// those keys contain backslashes, while HTTP requests always contain slashes.
// Normalize only the fallback lookup until the upstream package does so.
if (path.sep === "\\") {
  const originalLookup = StaticFileCache.prototype.lookup;
  StaticFileCache.prototype.lookup = function lookup(pathname) {
    const direct = originalLookup.call(this, pathname);
    if (direct !== undefined || !pathname.startsWith("/")) {
      return direct;
    }
    const windowsKey = `/${pathname.slice(1).split("/").join(path.sep)}`;
    return originalLookup.call(this, windowsKey);
  };
}

const port = args.port ?? Number.parseInt(process.env.PORT ?? "3000", 10);
const host = args.hostname ?? "0.0.0.0";
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`Invalid production port: ${String(port)}`);
}

const { startProdServer } = await import(
  "../node_modules/vinext/dist/server/prod-server.js"
);

await startProdServer({
  port,
  host,
  outDir: path.join(root, "dist"),
});
