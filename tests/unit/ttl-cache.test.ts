import { describe, expect, it } from "vitest";
import { stableCacheKey, TtlCache } from "../../src/cache/ttl-cache.js";

describe("TtlCache", () => {
  it("returns cached values while the TTL is active", () => {
    const cache = new TtlCache<string>(60);
    cache.set("part-search", "cached-result");

    expect(cache.get("part-search")).toBe("cached-result");
    expect(cache.stats()).toMatchObject({
      hits: 1,
      misses: 0,
      writes: 1,
      size: 1,
      ttlSeconds: 60
    });
  });

  it("can be disabled with a zero TTL", () => {
    const cache = new TtlCache<string>(0);
    cache.set("part-search", "cached-result");

    expect(cache.get("part-search")).toBeUndefined();
    expect(cache.stats()).toMatchObject({
      hits: 0,
      misses: 1,
      writes: 0,
      size: 0,
      ttlSeconds: 0
    });
  });

  it("builds stable keys regardless of object property order", () => {
    const first = stableCacheKey({
      supplier: "mouser",
      query: "M12 connector",
      constraints: {
        marketplaceAllowed: false,
        inStockOnly: true
      }
    });
    const second = stableCacheKey({
      constraints: {
        inStockOnly: true,
        marketplaceAllowed: false
      },
      query: "M12 connector",
      supplier: "mouser"
    });

    expect(first).toBe(second);
  });
});
