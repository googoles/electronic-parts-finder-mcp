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

  it("prioritizes normalized Korean variants without dropping the original query", () => {
    const plan = buildSearchPlan({
      query: "엔코더 달린 DC 기어모터",
      limit: 10
    });

    expect(plan.queries[0]).toContain("encoder");
    expect(plan.queries[0]).toContain("gear motor");
    expect(plan.queries).toContain("엔코더 달린 DC 기어모터");
    expect(plan.queries.some((query) => query.includes("encoder"))).toBe(true);
    expect(plan.queries.some((query) => query.includes("gear motor"))).toBe(true);
    expect(plan.notes.join(" ")).toContain("supplier-friendly normalized query");
  });

  it("normalizes industrial automation and terminal-block field language", () => {
    const normalized = normalizeSearchQueryForSuppliers("PLC 입출력 모듈 단자대 푸시인 24V 디지털 입력");

    expect(normalized.normalizedQuery).toContain("PLC I/O module");
    expect(normalized.normalizedQuery).toContain("screw terminal block");
    expect(normalized.normalizedQuery).toContain("spring clamp terminal block");
    expect(normalized.normalizedQuery).toContain("digital input module");
    expect(normalized.addedTerms).toContain("industrial automation module");
    expect(normalized.addedTerms).toContain("industrial terminal block");
  });

  it("normalizes common circular connector shorthand from field Korean", () => {
    const variants = normalizedQueryVariants("M12 4핀 암형 패널형 방수 항공 커넥터");
    const text = variants.join(" ");

    expect(text).toContain("M12");
    expect(text).toContain("4 pin");
    expect(text).toContain("female");
    expect(text).toContain("panel mount");
    expect(text).toContain("waterproof");
    expect(text).toContain("circular connector");
  });
});
