import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readCodexFlowVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" && manifest.version ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const CODEXFLOW_VERSION = readCodexFlowVersion();
