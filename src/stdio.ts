#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createCodexFlowServer } from "./server.js";
import { CODEXFLOW_VERSION } from "./version.js";

function printHelp(): void {
  console.log(`CodexFlow MCP stdio server

Usage:
  codexflow-mcp --root /path/to/repo [--allow-root /path]
  codexflow-mcp --version
  codexflow-mcp --help

Most users should run: codexflow`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v") || argv[0] === "version") {
    console.log(CODEXFLOW_VERSION);
    return;
  }
  if (argv.includes("--help") || argv[0] === "help") {
    printHelp();
    return;
  }

  process.env.CODEXFLOW_ALLOW_NO_HTTP_TOKEN ??= "1";
  const config = loadConfig();
  const server = createCodexFlowServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
