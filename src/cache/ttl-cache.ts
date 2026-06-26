export type TtlCacheStats = {
  hits: number;
  misses: number;
  writes: number;
  size: number;
  ttlSeconds: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private writes = 0;

  constructor(private readonly ttlSeconds: number) {}

  get enabled(): boolean {
    return this.ttlSeconds > 0;
  }

  get(key: string): T | undefined {
    if (!this.enabled) {
      this.misses += 1;
      return undefined;
    }

    const entry = this.entries.get(key);
    const now = Date.now();
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }

    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (!this.enabled) {
      return;
    }
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlSeconds * 1000
    });
    this.writes += 1;
  }

  stats(): TtlCacheStats {
    this.pruneExpired();
    return {
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      size: this.entries.size,
      ttlSeconds: this.ttlSeconds
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export function stableCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(sortValue(parts));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
