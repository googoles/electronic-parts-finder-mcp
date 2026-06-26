import { describe, expect, it } from "vitest";
import { normalizeSearchQueryForSuppliers, normalizedQueryVariants } from "../../src/search/query-normalization.js";
import { buildSearchPlan } from "../../src/search/ranking.js";

describe("query normalization", () => {
  it("translates Korean connector field terms into supplier-friendly English", () => {
    const normalized = normalizeSearchQueryForSuppliers("2핀 회색 커넥터 하우징 2.54미리");

    expect(normalized.normalizedQuery).toContain("2 pin");
    expect(normalized.normalizedQuery).toContain("gray");
    expect(normalized.normalizedQuery).toContain("connector");
    expect(normalized.normalizedQuery).toContain("housing");
    expect(normalized.normalizedQuery).toContain("2.54mm");
    expect(normalized.addedTerms).toContain("0.100 inch pitch");
  });

  it("adds marketplace and distributor friendly variants for circular connector language", () => {
    const variants = normalizedQueryVariants("M12 4핀 패널마운트 방수 커넥터");

    expect(variants.join(" ")).toContain("M12");
    expect(variants.join(" ")).toContain("4 pin");
    expect(variants.join(" ")).toContain("panel mount");
    expect(variants.join(" ")).toContain("waterproof");
    expect(variants.join(" ")).toContain("M12 circular connector");
  });

  it("adds normalized Korean variants to the search plan without dropping the original query", () => {
    const plan = buildSearchPlan({
      query: "엔코더 달린 DC 기어모터",
      limit: 10
    });

    expect(plan.queries[0]).toBe("엔코더 달린 DC 기어모터");
    expect(plan.queries.some((query) => query.includes("encoder"))).toBe(true);
    expect(plan.queries.some((query) => query.includes("gear motor"))).toBe(true);
    expect(plan.notes.join(" ")).toContain("supplier-friendly normalized query");
  });
});
