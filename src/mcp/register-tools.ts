import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stableCacheKey, TtlCache, type TtlCacheStats } from "../cache/ttl-cache.js";
import type { PartCandidate } from "../normalize/normalized-part.js";
import type { PartsFinderConfig } from "../config/env.js";
import { normalizeSearchQueryForSuppliers } from "../search/query-normalization.js";
import {
  bestUnitPrice,
  buildFallbackSearchPlan,
  buildSearchPlan,
  compareCandidates,
  isLikelyExactPart,
  rankAndFilterCandidates
} from "../search/ranking.js";
import { AliExpressClient } from "../suppliers/aliexpress/client.js";
import { DigiKeyClient } from "../suppliers/digikey/client.js";
import { MouserClient } from "../suppliers/mouser/client.js";
import { supplierIds, type SearchPartsInput, type SupplierId, type SupplierStatus } from "../suppliers/supplier.js";
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
      ? "Configured; live search adapter is enabled."
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

function formatMm(value: number): string {
  return `${Number(value.toFixed(3))}mm`;
}

function dimensionTerms(dimensions: { length?: number; width?: number; height?: number } | undefined): string[] {
  if (!dimensions) {
    return [];
  }
  const compact = [dimensions.length, dimensions.width, dimensions.height]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .map((value) => formatMm(value));
  return [
    compact.length >= 2 ? compact.join(" x ") : undefined,
    dimensions.length ? `${formatMm(dimensions.length)} length` : undefined,
    dimensions.width ? `${formatMm(dimensions.width)} width` : undefined,
    dimensions.height ? `${formatMm(dimensions.height)} height` : undefined
  ].filter((term): term is string => Boolean(term));
}

type SupplierSearchResult = {
  candidates: PartCandidate[];
  rawCount: number;
  warnings: string[];
};

export function registerTools(server: McpServer, config: PartsFinderConfig): void {
  const mouserClient = new MouserClient(config.suppliers.mouser);
  const digikeyClient = new DigiKeyClient(config.suppliers.digikey);
  const aliexpressClient = new AliExpressClient(config.suppliers.aliexpress);
  const supplierSearchCache = new TtlCache<SupplierSearchResult>(config.cache.ttlSeconds);

  async function searchSuppliers(input: SearchPartsInput): Promise<{
    candidates: PartCandidate[];
    rawCount: number;
    warnings: string[];
    searchPlan: ReturnType<typeof buildSearchPlan>;
    cache: TtlCacheStats;
  }> {
    const allowed = new Set(input.suppliers ?? supplierIds);
    const warnings: string[] = [];
    const candidates: PartCandidate[] = [];
    let rawCount = 0;
    const searchPlan = buildSearchPlan(input);
    const shouldSearchAliExpress = allowed.has("aliexpress") && input.constraints?.marketplaceAllowed;

    for (const supplier of supplierIds) {
      if (allowed.has(supplier) && supplier !== "aliexpress" && !config.suppliers[supplier].enabled) {
        warnings.push(`${supplier} skipped: missing ${config.suppliers[supplier].missing.join(", ")}`);
      }
    }
    if (shouldSearchAliExpress && !config.suppliers.aliexpress.enabled) {
      warnings.push(
        `aliexpress skipped: missing ${config.suppliers.aliexpress.missing.join(", ")}`
      );
    }

    const runSupplierQueries = async (queries: string[]) => {
      for (const query of queries) {
        if (allowed.has("mouser") && config.suppliers.mouser.enabled) {
          try {
            const mouserResult = await cachedSupplierSearch("mouser", query, input, () =>
              mouserClient.searchKeyword({
                query,
                limit: input.limit,
                inStockOnly: input.constraints?.inStockOnly
              })
            );
            candidates.push(...mouserResult.candidates);
            rawCount += mouserResult.rawCount;
            warnings.push(...mouserResult.warnings);
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "Mouser Search API failed.");
          }
        }

        if (allowed.has("digikey") && config.suppliers.digikey.enabled) {
          try {
            const digikeyResult = await cachedSupplierSearch("digikey", query, input, () =>
              digikeyClient.searchKeyword({
                query,
                limit: input.limit,
                inStockOnly: input.constraints?.inStockOnly
              })
            );
            candidates.push(...digikeyResult.candidates);
            rawCount += digikeyResult.rawCount;
            warnings.push(...digikeyResult.warnings);
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "DigiKey ProductInformation V4 failed.");
          }
        }

        if (shouldSearchAliExpress && config.suppliers.aliexpress.enabled) {
          try {
            const aliexpressResult = await cachedSupplierSearch("aliexpress", query, input, () =>
              aliexpressClient.searchKeyword({
                query,
                limit: input.limit,
                marketplaceAllowed: true
              })
            );
            candidates.push(...aliexpressResult.candidates);
            rawCount += aliexpressResult.rawCount;
            warnings.push(...aliexpressResult.warnings);
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "AliExpress Open Platform search failed.");
          }
        }
      }
    };

    await runSupplierQueries(searchPlan.queries);
    let rankedCandidates = rankAndFilterCandidates(candidates, input);
    if (rankedCandidates.length === 0) {
      const fallbackPlan = buildFallbackSearchPlan(input, searchPlan.queries);
      if (fallbackPlan.queries.length > 0) {
        searchPlan.queries.push(...fallbackPlan.queries);
        searchPlan.notes.push(...fallbackPlan.notes);
        await runSupplierQueries(fallbackPlan.queries);
        rankedCandidates = rankAndFilterCandidates(candidates, input);
      }
    }

    return {
      candidates: rankedCandidates,
      rawCount,
      warnings,
      searchPlan,
      cache: supplierSearchCache.stats()
    };
  }

  async function cachedSupplierSearch(
    supplier: SupplierId,
    query: string,
    input: SearchPartsInput,
    fetcher: () => Promise<SupplierSearchResult>
  ): Promise<SupplierSearchResult> {
    const key = stableCacheKey({
      supplier,
      query,
      limit: input.limit,
      constraints: {
        inStockOnly: input.constraints?.inStockOnly,
        marketplaceAllowed: input.constraints?.marketplaceAllowed
      }
    });
    const cached = supplierSearchCache.get(key);
    if (cached) {
      return cached;
    }

    const fresh = await fetcher();
    supplierSearchCache.set(key, fresh);
    return fresh;
  }

  server.tool(
    "search_parts",
    "Search configured distributor and marketplace suppliers for engineering part candidates.",
    SearchPartsInputSchema.shape,
    async (input) => {
      const statuses = selectedSupplierStatus(config, input.suppliers);
      const result = await searchSuppliers(input);
      const requestedSuppliers = new Set(input.suppliers ?? supplierIds);

      return jsonResult({
        candidates: result.candidates,
        supplierStatus: statuses,
        searchStrategy: {
          query: input.query,
          expandedQueries: result.searchPlan.queries,
          notes: result.searchPlan.notes,
          categoryHint: input.categoryHint,
          limit: input.limit,
          marketplaceAllowed: input.constraints?.marketplaceAllowed ?? false,
          visualHints: input.visualHints,
          cache: result.cache
        },
        rawCount: result.rawCount,
        warnings: [
          ...result.warnings,
          ...statuses
            .filter(
              (status) =>
                !status.enabled &&
                (status.supplier !== "aliexpress" ||
                  input.constraints?.marketplaceAllowed === true ||
                  input.suppliers?.includes("aliexpress") === true) &&
                requestedSuppliers.has(status.supplier) &&
                !result.warnings.some((warning) => warning.startsWith(`${status.supplier} skipped:`))
            )
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
        input.connectorRowCount ? `${input.connectorRowCount} row connector` : undefined,
        input.connectorPitchMm ? `${input.connectorPitchMm}mm pitch` : undefined,
        input.connectorGender,
        input.connectorMountingStyle,
        input.connectorFamily,
        input.cableWireCount ? `${input.cableWireCount} wire cable` : undefined,
        ...dimensionTerms(input.dimensionsMm),
        input.motorHints?.hasEncoder ? "encoder motor" : undefined,
        input.motorHints?.gearhead ? "gear motor" : undefined,
        input.motorHints?.shaftDiameterMm ? `${formatMm(input.motorHints.shaftDiameterMm)} shaft` : undefined,
        input.motorHints?.bodyDiameterMm ? `${formatMm(input.motorHints.bodyDiameterMm)} motor diameter` : undefined,
        input.motorHints?.bodyLengthMm ? `${formatMm(input.motorHints.bodyLengthMm)} motor length` : undefined,
        input.motorHints?.connectorType,
        ...(input.boardContext ?? [])
      ].filter((term): term is string => Boolean(term));
      const draftQuery = [input.userGoal, ...queryTerms].filter(Boolean).join(" ");
      const normalizedDraft = normalizeSearchQueryForSuppliers(draftQuery);

      return jsonResult({
        queryTerms,
        normalizedQueryTerms: normalizedDraft.addedTerms,
        searchPartsInputDraft: {
          query: normalizedDraft.normalizedQuery,
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
    async (input) => {
      const searchInput: SearchPartsInput = {
        query: input.partNumber,
        suppliers: input.supplier ? [input.supplier] : undefined,
        constraints: undefined,
        limit: 10
      };
      const result = await searchSuppliers(searchInput);
      const matches = result.candidates
        .map((candidate) => ({
          ...candidate,
          match: {
            ...candidate.match,
            warnings: isLikelyExactPart(candidate, input.partNumber)
              ? candidate.match.warnings
              : [...candidate.match.warnings, "Part number was not an exact normalized MPN or supplier PN match."]
          }
        }))
        .sort((a, b) => {
          const exactDelta = Number(isLikelyExactPart(b, input.partNumber)) - Number(isLikelyExactPart(a, input.partNumber));
          return exactDelta || compareCandidates(a, b);
        });

      return jsonResult({
        partNumber: input.partNumber,
        kind: input.kind,
        supplierStatus: selectedSupplierStatus(config, input.supplier ? [input.supplier] : undefined),
        matches,
        rawCount: result.rawCount,
        searchStrategy: {
          expandedQueries: result.searchPlan.queries,
          notes: result.searchPlan.notes
        },
        warnings: result.warnings
      });
    }
  );

  server.tool(
    "compare_parts",
    "Compare two to ten known part numbers or candidates.",
    ComparePartsInputSchema.shape,
    async (input) => {
      const resolved = [];
      const warnings: string[] = [];

      for (const partNumber of input.parts) {
        const result = await searchSuppliers({
          query: partNumber,
          constraints: undefined,
          limit: 5
        });
        warnings.push(...result.warnings);
        resolved.push({
          requested: partNumber,
          bestMatch: result.candidates.find((candidate) => isLikelyExactPart(candidate, partNumber)) ?? result.candidates[0],
          candidateCount: result.candidates.length,
          rawCount: result.rawCount
        });
      }

      return jsonResult({
        parts: input.parts,
        criteria: input.criteria ?? ["availability", "price", "fit", "datasheet"],
        comparisons: resolved.map((item) => ({
          requested: item.requested,
          found: Boolean(item.bestMatch),
          candidateCount: item.candidateCount,
          supplier: item.bestMatch?.supplier,
          manufacturer: item.bestMatch?.manufacturer,
          manufacturerPartNumber: item.bestMatch?.manufacturerPartNumber,
          supplierPartNumber: item.bestMatch?.supplierPartNumber,
          description: item.bestMatch?.description,
          score: item.bestMatch?.score,
          inStockQuantity: item.bestMatch?.availability.inStockQuantity,
          stockText: item.bestMatch?.availability.stockText,
          leadTime: item.bestMatch?.availability.leadTime,
          unitPrice: item.bestMatch ? bestUnitPrice(item.bestMatch) : undefined,
          currency: item.bestMatch?.pricing[0]?.currency,
          lifecycleStatus: item.bestMatch?.lifecycleStatus,
          datasheetUrl: item.bestMatch?.datasheetUrl,
          productUrl: item.bestMatch?.productUrl,
          confidence: item.bestMatch?.match.confidence,
          fitSummary: item.bestMatch?.match.fitSummary,
          verificationChecklist: item.bestMatch?.match.verificationChecklist,
          warnings: item.bestMatch?.match.warnings ?? []
        })),
        warnings
      });
    }
  );

  server.tool(
    "suggest_alternates",
    "Suggest alternate parts for unavailable, costly, obsolete, or second-source needs.",
    SuggestAlternatesInputSchema.shape,
    async (input) => {
      const seedResult = await searchSuppliers({
        query: input.partNumber,
        constraints: undefined,
        limit: 8
      });
      const seed = seedResult.candidates.find((candidate) => isLikelyExactPart(candidate, input.partNumber)) ?? seedResult.candidates[0];
      const alternateQuery = [
        seed?.categoryPath?.slice(-1)[0],
        seed?.manufacturerPartNumber ?? input.partNumber,
        ...(input.mustMatch ?? [])
      ]
        .filter(Boolean)
        .join(" ");
      const alternateResult = await searchSuppliers({
        query: alternateQuery || input.partNumber,
        categoryHint: seed?.categoryPath?.join(" "),
        constraints: {
          mustHave: input.mustMatch,
          marketplaceAllowed: false
        },
        limit: 12
      });
      const alternates = alternateResult.candidates.filter(
        (candidate) => !isLikelyExactPart(candidate, input.partNumber)
      );

      return jsonResult({
        seedPartNumber: input.partNumber,
        seed,
        reason: input.reason,
        mustMatch: input.mustMatch ?? [],
        alternates,
        searchStrategy: {
          seedQueries: seedResult.searchPlan.queries,
          alternateQueries: alternateResult.searchPlan.queries
        },
        warnings: [
          ...seedResult.warnings,
          ...alternateResult.warnings,
          "Alternates are search-derived suggestions; verify datasheet, pinout, package, ratings, and compliance before substitution."
        ]
      });
    }
  );

  server.tool(
    "enrich_bom",
    "Enrich BOM-like rows with supplier availability, pricing, and sourcing caveats.",
    EnrichBomInputSchema.shape,
    async (input) => {
      const enriched = [];
      const unresolved = [];
      const warnings: string[] = [];

      for (const item of input.items) {
        const result = await searchSuppliers({
          query: [item.manufacturer, item.partNumber].filter(Boolean).join(" "),
          suppliers: input.suppliers,
          constraints: item.manufacturer ? { manufacturer: [item.manufacturer] } : undefined,
          limit: 5
        });
        warnings.push(...result.warnings);
        const bestMatch = result.candidates.find((candidate) => isLikelyExactPart(candidate, item.partNumber)) ?? result.candidates[0];
        if (!bestMatch) {
          unresolved.push({
            ...item,
            reason: "No supplier candidate returned."
          });
          continue;
        }

        enriched.push({
          ...item,
          supplier: bestMatch.supplier,
          manufacturer: bestMatch.manufacturer || item.manufacturer,
          manufacturerPartNumber: bestMatch.manufacturerPartNumber,
          supplierPartNumber: bestMatch.supplierPartNumber,
          description: bestMatch.description,
          score: bestMatch.score,
          inStockQuantity: bestMatch.availability.inStockQuantity,
          stockText: bestMatch.availability.stockText,
          leadTime: bestMatch.availability.leadTime,
          unitPrice: bestUnitPrice(bestMatch, input.pricingQuantity ?? item.quantity),
          currency: bestMatch.pricing[0]?.currency,
          lifecycleStatus: bestMatch.lifecycleStatus,
          datasheetUrl: bestMatch.datasheetUrl,
          productUrl: bestMatch.productUrl,
          confidence: bestMatch.match.confidence,
          fitSummary: bestMatch.match.fitSummary,
          verificationChecklist: bestMatch.match.verificationChecklist,
          warnings: bestMatch.match.warnings
        });
      }

      return jsonResult({
        items: input.items,
        supplierStatus: selectedSupplierStatus(config, input.suppliers),
        pricingQuantity: input.pricingQuantity,
        enriched,
        unresolved,
        warnings
      });
    }
  );
}
