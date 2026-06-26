import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  {
    name: "parts-finder-smoke",
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
      query: "STM32 CAN FD microcontroller",
      suppliers: ["mouser"],
      constraints: {
        inStockOnly: true
      },
      limit: 2
    }
  });

  const structured = result.structuredContent as {
    candidates?: Array<{
      manufacturerPartNumber?: string;
      manufacturer?: string;
      supplierPartNumber?: string;
    }>;
    rawCount?: number;
  };

  console.log(`Raw count: ${structured.rawCount ?? 0}`);
  for (const candidate of structured.candidates ?? []) {
    console.log(
      `- ${candidate.manufacturerPartNumber ?? "(no MPN)"} ${candidate.manufacturer ?? ""} ${
        candidate.supplierPartNumber ?? ""
      }`.trim()
    );
  }
} finally {
  await client.close();
}
