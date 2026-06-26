import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config/env.js";
import { registerTools } from "./mcp/register-tools.js";

export function createServer(): McpServer {
  const config = loadConfig();
  const server = new McpServer({
    name: "parts-finder-mcp",
    version: "0.1.0"
  });

  registerTools(server, config);
  return server;
}
