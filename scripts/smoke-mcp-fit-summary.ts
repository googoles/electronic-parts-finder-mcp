import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  {
    name: "parts-finder-fit-summary-smoke",
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
      limit: 1
    }
  });

  const structured = result.structuredContent as {
    candidates?: Array<{
      score?: number;
      match?: {
        confidence?: string;
        fitSummary?: string;
        verificationChecklist?: string[];
      };
    }>;
  };

  const first = structured.candidates?.[0];
  console.log(`Score: ${first?.score ?? 0}`);
  console.log(`Confidence: ${first?.match?.confidence ?? "(missing)"}`);
  console.log(`Fit summary: ${first?.match?.fitSummary ?? "(missing)"}`);
  console.log(`Checklist items: ${first?.match?.verificationChecklist?.length ?? 0}`);
} finally {
  await client.close();
}
