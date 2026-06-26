import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  {
    name: "parts-finder-aliexpress-smoke",
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
  const result = await client.callTool({
    name: "search_parts",
    arguments: {
      query: "M12 4 pin waterproof panel mount connector",
      suppliers: ["aliexpress"],
      constraints: {
        marketplaceAllowed: true
      },
      limit: 2
    }
  });

  const structured = result.structuredContent as {
    candidates?: unknown[];
    rawCount?: number;
    warnings?: string[];
  };

  console.log(`Raw count: ${structured.rawCount ?? 0}`);
  console.log(`Candidates: ${structured.candidates?.length ?? 0}`);
  for (const warning of structured.warnings ?? []) {
    console.log(`Warning: ${warning.replace(/\s+/g, " ").slice(0, 500)}`);
  }
} finally {
  await client.close();
}
