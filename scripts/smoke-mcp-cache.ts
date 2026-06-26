import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  {
    name: "parts-finder-cache-smoke",
    version: "0.1.0"
  },
  {
    capabilities: {}
  }
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
});

await client.connect(transport);

try {
  const request = {
    name: "search_parts",
    arguments: {
      query: "STM32 CAN FD microcontroller",
      suppliers: ["mouser"],
      constraints: {
        inStockOnly: true
      },
      limit: 2
    }
  } as const;

  await client.callTool(request);
  const second = await client.callTool(request);
  const structured = second.structuredContent as {
    searchStrategy?: {
      cache?: {
        hits?: number;
        misses?: number;
        writes?: number;
        size?: number;
      };
    };
  };

  const cache = structured.searchStrategy?.cache;
  console.log(`Cache hits: ${cache?.hits ?? 0}`);
  console.log(`Cache misses: ${cache?.misses ?? 0}`);
  console.log(`Cache writes: ${cache?.writes ?? 0}`);
  console.log(`Cache size: ${cache?.size ?? 0}`);
} finally {
  await client.close();
}
