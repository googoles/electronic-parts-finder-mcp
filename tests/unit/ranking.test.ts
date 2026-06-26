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
    expect(plan.queries.length).toBeLessThanOrEqual(4);
    expect(plan.queries.join(" ")).toContain("20 pin");
    expect(plan.queries.join(" ")).toContain("2.54mm");
  });

  it("matches visual connector hints against supplier wording variants", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          manufacturerPartNumber: "MATCH-20",
          description: "CONN HEADER IDC 20POS 2ROW 0.100\" GOLD through hole box header"
        }),
        candidate({
          manufacturerPartNumber: "MISS-12",
          description: "CONN HEADER IDC 12 Position 2.00mm surface mount"
        })
      ],
      {
        query: "debug connector",
        visualHints: {
          connectorPinCount: 20,
          connectorRowCount: 2,
          connectorPitchMm: 2.54,
          connectorFamily: "IDC",
          connectorMountingStyle: "through hole"
        },
        limit: 10
      }
    );

    expect(ranked[0]?.manufacturerPartNumber).toBe("MATCH-20");
    expect(ranked[0]?.match.matched.join(" ")).toContain("pin/position count: 20");
    expect(ranked[0]?.match.matched.join(" ")).toContain("pitch:");
  });

  it("uses connector hints inferred from rough query text for ranking", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          manufacturerPartNumber: "RIGHT-2P",
          description: "2 Position crimp housing 2.54mm pitch gray connector"
        }),
        candidate({
          manufacturerPartNumber: "WRONG-4P",
          description: "4 Position crimp housing 2.00mm pitch black connector"
        })
      ],
      {
        query: "2핀 회색 커넥터 하우징 2.54미리",
        limit: 10
      }
    );

    expect(ranked[0]?.manufacturerPartNumber).toBe("RIGHT-2P");
    expect(ranked[0]?.match.matched.join(" ")).toContain("pin/position count: 2");
    expect(ranked[0]?.match.matched.join(" ")).toContain("pitch:");
    expect(ranked[0]?.match.confidence).toMatch(/high|medium/);
    expect(ranked[0]?.match.fitSummary).toContain("score");
    expect(ranked[0]?.match.verificationChecklist?.join(" ")).toContain("pin/position count");
  });

  it("ranks field Korean circular connector shorthand with inferred family, gender, and mounting", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          manufacturerPartNumber: "M12-RIGHT",
          description: "M12 4 position female panel mount waterproof circular connector"
        }),
        candidate({
          manufacturerPartNumber: "M12-WRONG",
          description: "M12 5 position male cable mount waterproof circular connector"
        })
      ],
      {
        query: "M12 4핀 암형 패널형 방수 항공 커넥터",
        limit: 10
      }
    );

    expect(ranked[0]?.manufacturerPartNumber).toBe("M12-RIGHT");
    expect(ranked[0]?.match.matched.join(" ")).toContain("query terms:");
    expect(ranked[0]?.match.matched.join(" ")).toContain("waterproof");
    expect(ranked[0]?.match.matched.join(" ")).toContain("circular");
    expect(ranked[0]?.match.matched.join(" ")).toContain("pin/position count: 4");
    expect(ranked[0]?.match.matched.join(" ")).toContain("mounting style: panel mount");
    expect(ranked[0]?.match.matched.join(" ")).toContain("connector gender/type: female");
  });

  it("adds marketplace-specific verification caveats", () => {
    const ranked = rankAndFilterCandidates(
      [
        candidate({
          supplier: "aliexpress",
          supplierPartNumber: "100500",
          manufacturer: "Marketplace Store",
          manufacturerPartNumber: "",
          description: "M12 4 pin waterproof panel mount connector",
          marketplace: {
            sellerName: "Marketplace Store",
            orderCount: 120,
            productRating: 4.7
          }
        })
      ],
      {
        query: "M12 4 pin waterproof panel mount connector",
        constraints: {
          marketplaceAllowed: true
        },
        limit: 10
      }
    );

    expect(ranked[0]?.match.confidence).not.toBe("high");
    expect(ranked[0]?.match.verificationChecklist?.join(" ")).toContain("marketplace listings");
  });

  it("does not treat measurement units as exact part-number queries", () => {
    const plan = buildSearchPlan({
      query: "2.54mm pitch 20 pin IDC connector",
      limit: 10
    });

    expect(plan.queries[0]).toBe("2.54mm pitch 20 pin IDC connector");
    expect(plan.notes.join(" ")).not.toContain("exact-looking part number");
    expect(plan.notes.join(" ")).not.toContain("joined part-number");
  });

  it("joins split OCR-like part number tokens into an exact query", () => {
    const plan = buildSearchPlan({
      query: "STM32 C552 RET6",
      limit: 10
    });

    expect(plan.queries).toContain("STM32C552RET6");
    expect(plan.notes.join(" ")).toContain("joined part-number query");
  });

  it("builds compact connector query variants from row count and pitch", () => {
    const plan = buildSearchPlan({
      query: "black programming connector",
      visualHints: {
        connectorPinCount: 20,
        connectorRowCount: 2,
        connectorPitchMm: 2.54,
        connectorFamily: "IDC box header"
      },
      limit: 10
    });

    expect(plan.queries.some((query) => query.includes("2x10"))).toBe(true);
    expect(plan.queries.some((query) => query.includes("0.100 inch pitch"))).toBe(true);
  });
});

function candidate(overrides: Partial<PartCandidate>): PartCandidate {
  return {
    supplier: overrides.supplier ?? "digikey",
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
    marketplace: overrides.marketplace,
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
