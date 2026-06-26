import { describe, expect, it } from "vitest";
import type { PartCandidate } from "../../src/normalize/normalized-part.js";
import { buildSearchPlan, rankAndFilterCandidates } from "../../src/search/ranking.js";

describe("search ranking", () => {
  it("boosts exact manufacturer part number matches above looser text matches", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          manufacturerPartNumber: "ABC-123",
          description: "2x10 IDC box header 2.54mm"
        }),
        candidate({
          manufacturerPartNumber: "ABC-1234",
          description: "ABC family connector"
        })
      ],
      {
        query: "ABC-123",
        limit: 10
      }
    );

    expect(ranked[0]?.manufacturerPartNumber).toBe("ABC-123");
    expect(ranked[0]?.match.matched.join(" ")).toContain("exact part number");
  });

  it("filters candidates that fail hard manufacturer and price constraints", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          manufacturer: "Molex",
          manufacturerPartNumber: "50-57-9402",
          pricing: [{ quantity: 1, unitPrice: 0.23, currency: "USD" }]
        }),
        candidate({
          manufacturer: "JST",
          manufacturerPartNumber: "XHP-2",
          pricing: [{ quantity: 1, unitPrice: 0.12, currency: "USD" }]
        }),
        candidate({
          manufacturer: "Molex",
          manufacturerPartNumber: "EXPENSIVE-2",
          pricing: [{ quantity: 1, unitPrice: 20, currency: "USD" }]
        })
      ],
      {
        query: "2 pin housing",
        constraints: {
          manufacturer: ["Molex"],
          maxUnitPrice: 1
        },
        limit: 10
      }
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.manufacturerPartNumber).toBe("50-57-9402");
  });

  it("builds bounded expanded queries from visual connector hints", () => {
    const plan = buildSearchPlan({
      query: "debug connector",
      categoryHint: "IDC box header",
      visualHints: {
        connectorPinCount: 20,
        connectorPitchMm: 2.54,
        boardContext: ["ARM JTAG", "STM32 board"]
      },
      limit: 10
    });

    expect(plan.queries.length).toBeGreaterThan(1);
    expect(plan.queries.length).toBeLessThanOrEqual(3);
    expect(plan.queries.join(" ")).toContain("20 pin");
    expect(plan.queries.join(" ")).toContain("2.54mm");
  });

  it("does not treat measurement units as exact part-number queries", () => {
    const plan = buildSearchPlan({
      query: "2.54mm pitch 20 pin IDC connector",
      limit: 10
    });

    expect(plan.queries).toEqual(["2.54mm pitch 20 pin IDC connector"]);
  });
});

function candidate(overrides: Partial<PartCandidate>): PartCandidate {
  return {
    supplier: "digikey",
    supplierPartNumber: overrides.supplierPartNumber ?? overrides.manufacturerPartNumber ?? "DK-1",
    manufacturerPartNumber: overrides.manufacturerPartNumber ?? "MPN-1",
    manufacturer: overrides.manufacturer ?? "Example",
    description: overrides.description ?? "Example part",
    categoryPath: overrides.categoryPath,
    productUrl: "https://example.com/product",
    datasheetUrl: "https://example.com/datasheet.pdf",
    availability: overrides.availability ?? {
      inStockQuantity: 100,
      stockText: "100 available"
    },
    pricing: overrides.pricing ?? [{ quantity: 1, unitPrice: 1, currency: "USD" }],
    minimumOrderQuantity: overrides.minimumOrderQuantity,
    packaging: overrides.packaging,
    lifecycleStatus: overrides.lifecycleStatus,
    compliance: overrides.compliance ?? { rohs: "yes" },
    specs: overrides.specs ?? {},
    source: {
      fetchedAt: "2026-06-26T00:00:00.000Z",
      supplierApi: "test"
    },
    score: overrides.score ?? 50,
    match: overrides.match ?? {
      hardConstraintPass: true,
      matched: [],
      missing: [],
      warnings: [],
      reasons: []
    }
  };
}
