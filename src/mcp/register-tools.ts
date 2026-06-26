import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PartsFinderConfig } from "../config/env.js";
import { DigiKeyClient } from "../suppliers/digikey/client.js";
import { MouserClient } from "../suppliers/mouser/client.js";
import { supplierIds, type SupplierId, type SupplierStatus } from "../suppliers/supplier.js";
import {
  ComparePartsInputSchema,
  EnrichBomInputSchema,
  ExtractVisualPartHintsInputSchema,
  LookupPartInputSchema,
  SearchPartsInputSchema,
  SuggestAlternatesInputSchema
} from "./schemas.js";

function supplierStatus(config: PartsFinderConfig): SupplierStatus[] {
  return supplierIds.map((supplier) => ({
    supplier,
    enabled: config.suppliers[supplier].enabled,
    missingCredentials: config.suppliers[supplier].missing,
    rateLimit: config.suppliers[supplier].rateLimit,
    note: config.suppliers[supplier].enabled
      ? "Configured; live adapter implementation is pending."
      : "Skipped because credentials are blank in .env."
  }));
}

function selectedSupplierStatus(
  config: PartsFinderConfig,
  requested?: SupplierId[]
): SupplierStatus[] {
  const allowed = new Set(requested ?? supplierIds);
  return supplierStatus(config).filter((status) => allowed.has(status.supplier));
}

function jsonResult(value: Record<string, unknown>) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: value
  };
}

export function registerTools(server: McpServer, config: PartsFinderConfig): void {
  const mouserClient = new MouserClient(config.suppliers.mouser);
  const digikeyClient = new DigiKeyClient(config.suppliers.digikey);

  server.tool(
    "search_parts",
    "Search configured distributor and marketplace suppliers for engineering part candidates.",
    SearchPartsInputSchema.shape,
    async (input) => {
      const statuses = selectedSupplierStatus(config, input.suppliers);
      const allowed = new Set(input.suppliers ?? supplierIds);
      const warnings: string[] = [];
      const candidates = [];
      let rawCount = 0;

      if (allowed.has("mouser")) {
        try {
          const mouserResult = await mouserClient.searchKeyword({
            query: input.query,
            limit: input.limit,
            inStockOnly: input.constraints?.inStockOnly
          });
          candidates.push(...mouserResult.candidates);
          rawCount += mouserResult.rawCount;
          warnings.push(...mouserResult.warnings);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Mouser Search API failed.");
        }
      }

      if (allowed.has("digikey")) {
        try {
          const digikeyResult = await digikeyClient.searchKeyword({
            query: input.query,
            limit: input.limit,
            inStockOnly: input.constraints?.inStockOnly
          });
          candidates.push(...digikeyResult.candidates);
          rawCount += digikeyResult.rawCount;
          warnings.push(...digikeyResult.warnings);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "DigiKey ProductInformation V4 failed.");
        }
      }

      return jsonResult({
        candidates,
        supplierStatus: statuses,
        searchStrategy: {
          query: input.query,
          categoryHint: input.categoryHint,
          limit: input.limit,
          marketplaceAllowed: input.constraints?.marketplaceAllowed ?? false,
          visualHints: input.visualHints
        },
        rawCount,
        warnings: [
          ...warnings,
          ...statuses
            .filter((status) => status.supplier !== "mouser" && status.supplier !== "digikey" && !status.enabled)
            .map((status) => `${status.supplier} skipped: missing ${status.missingCredentials.join(", ")}`)
        ]
      });
    }
  );

  server.tool(
    "extract_visual_part_hints",
    "Normalize image-recognition observations into searchable part hints. The MCP server does not process raw images; pass observations from Codex/Claude vision.",
    ExtractVisualPartHintsInputSchema.shape,
    async (input) => {
      const queryTerms = [
        ...(input.visibleText ?? []),
        input.packageShape,
        input.pinCount ? `${input.pinCount} pin` : undefined,
        input.connectorPinCount ? `${input.connectorPinCount} pin connector` : undefined,
        input.connectorPitchMm ? `${input.connectorPitchMm}mm pitch` : undefined,
        input.cableWireCount ? `${input.cableWireCount} wire cable` : undefined,
        input.motorHints?.hasEncoder ? "encoder motor" : undefined,
        input.motorHints?.gearhead ? "gear motor" : undefined,
        ...(input.boardContext ?? [])
      ].filter((term): term is string => Boolean(term));

      return jsonResult({
        queryTerms,
        searchPartsInputDraft: {
          query: [input.userGoal, ...queryTerms].filter(Boolean).join(" "),
          visualHints: input
        },
        warnings: [
          "Treat image-derived markings and package guesses as low confidence until verified by datasheet or measured dimensions.",
          "For ICs, top marking alone is often insufficient; include package, pin count, board context, and nearby circuit function."
        ]
      });
    }
  );

  server.tool(
    "lookup_part",
    "Look up a known manufacturer or supplier part number.",
    LookupPartInputSchema.shape,
    async (input) =>
      jsonResult({
        partNumber: input.partNumber,
        kind: input.kind,
        supplierStatus: selectedSupplierStatus(config, input.supplier ? [input.supplier] : undefined),
        matches: [],
        warnings: ["Live lookup adapter is pending supplier credentials and API implementation."]
      })
  );

  server.tool(
    "compare_parts",
    "Compare two to ten known part numbers or candidates.",
    ComparePartsInputSchema.shape,
    async (input) =>
      jsonResult({
        parts: input.parts,
        criteria: input.criteria ?? ["availability", "price", "fit", "datasheet"],
        comparisons: [],
        warnings: ["Comparison requires lookup/search adapters to return normalized parts."]
      })
  );

  server.tool(
    "suggest_alternates",
    "Suggest alternate parts for unavailable, costly, obsolete, or second-source needs.",
    SuggestAlternatesInputSchema.shape,
    async (input) =>
      jsonResult({
        seedPartNumber: input.partNumber,
        reason: input.reason,
        mustMatch: input.mustMatch ?? [],
        alternates: [],
        warnings: ["Alternate suggestions require live supplier search adapters."]
      })
  );

  server.tool(
    "enrich_bom",
    "Enrich BOM-like rows with supplier availability, pricing, and sourcing caveats.",
    EnrichBomInputSchema.shape,
    async (input) =>
      jsonResult({
        items: input.items,
        supplierStatus: selectedSupplierStatus(config, input.suppliers),
        enriched: [],
        unresolved: input.items.map((item) => ({
          ...item,
          reason: "Live BOM enrichment adapter is pending."
        }))
      })
  );
}
