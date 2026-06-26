import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client(
  {
    name: "parts-finder-workflow-smoke",
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
  const lookup = await client.callTool({
    name: "lookup_part",
    arguments: {
      partNumber: "STM32C552KEU6",
      supplier: "mouser"
    }
  });
  const lookupStructured = lookup.structuredContent as {
    matches?: unknown[];
  };
  console.log(`Lookup matches: ${lookupStructured.matches?.length ?? 0}`);

  const compare = await client.callTool({
    name: "compare_parts",
    arguments: {
      parts: ["STM32C552KEU6", "STM32C552RET6"]
    }
  });
  const compareStructured = compare.structuredContent as {
    comparisons?: unknown[];
  };
  console.log(`Compare rows: ${compareStructured.comparisons?.length ?? 0}`);

  const bom = await client.callTool({
    name: "enrich_bom",
    arguments: {
      suppliers: ["mouser"],
      pricingQuantity: 10,
      items: [
        {
          refdes: "U1",
          partNumber: "STM32C552KEU6",
          manufacturer: "STMicroelectronics",
          quantity: 1
        }
      ]
    }
  });
  const bomStructured = bom.structuredContent as {
    enriched?: unknown[];
    unresolved?: unknown[];
  };
  console.log(`BOM enriched: ${bomStructured.enriched?.length ?? 0}`);
  console.log(`BOM unresolved: ${bomStructured.unresolved?.length ?? 0}`);
} finally {
  await client.close();
}
