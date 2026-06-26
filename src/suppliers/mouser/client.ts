import type { SupplierConfig } from "../../config/env.js";
import type { PartCandidate, NormalizedPart } from "../../normalize/normalized-part.js";

export type MouserSearchOptions = {
  query: string;
  limit: number;
  inStockOnly?: boolean;
};

type MouserPriceBreak = {
  Quantity?: number;
  Price?: string;
  Currency?: string;
};

type MouserPart = {
  Availability?: string;
  Category?: string;
  DataSheetUrl?: string;
  Description?: string;
  ImagePath?: string;
  Manufacturer?: string;
  ManufacturerPartNumber?: string;
  Min?: string;
  MouserPartNumber?: string;
  PriceBreaks?: MouserPriceBreak[];
  ProductAttributes?: Array<{
    AttributeName?: string;
    AttributeValue?: string;
  }>;
  ProductDetailUrl?: string;
  ROHSStatus?: string;
};

type MouserSearchResponse = {
  Errors?: Array<{ Code?: string; Message?: string; PropertyName?: string }>;
  SearchResults?: {
    NumberOfResult?: number;
    Parts?: MouserPart[];
  };
};

export class MouserClient {
  private requestTimestamps: number[] = [];
  private dayKey = "";
  private dayCount = 0;

  constructor(private readonly config: SupplierConfig) {}

  async searchKeyword(options: MouserSearchOptions): Promise<{
    candidates: PartCandidate[];
    rawCount: number;
    warnings: string[];
  }> {
    if (!this.config.enabled || !this.config.apiKey || !this.config.baseUrl) {
      return {
        candidates: [],
        rawCount: 0,
        warnings: ["Mouser Search API key is missing."]
      };
    }

    const url = new URL("/api/v1/search/keyword", this.config.baseUrl);
    url.searchParams.set("apiKey", this.config.apiKey);

    const body = {
      SearchByKeywordRequest: {
        keyword: options.query,
        records: Math.min(options.limit, 50),
        startingRecord: 0,
        searchOptions: options.inStockOnly ? "InStock" : "",
        searchWithYourSignUpLanguage: "false"
      }
    };

    this.assertWithinRateLimit();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const suffix = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
      throw new Error(`Mouser Search API returned HTTP ${response.status}.${suffix}`);
    }

    const payload = (await response.json()) as MouserSearchResponse;
    const apiErrors = payload.Errors?.filter((error) => error.Message || error.Code) ?? [];
    if (apiErrors.length > 0) {
      throw new Error(
        `Mouser Search API error: ${apiErrors
          .map((error) => [error.Code, error.PropertyName, error.Message].filter(Boolean).join(" "))
          .join("; ")}`
      );
    }

    const parts = payload.SearchResults?.Parts ?? [];
    return {
      candidates: parts.map((part) => toCandidate(part)),
      rawCount: payload.SearchResults?.NumberOfResult ?? parts.length,
      warnings: []
    };
  }

  private assertWithinRateLimit(): void {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.dayKey !== today) {
      this.dayKey = today;
      this.dayCount = 0;
    }

    const perMinute = this.config.rateLimit.perMinute;
    if (perMinute) {
      const oneMinuteAgo = now - 60_000;
      this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > oneMinuteAgo);
      if (this.requestTimestamps.length >= perMinute) {
        throw new Error(`Mouser local rate limit reached: ${perMinute} requests/minute.`);
      }
    }

    const perDay = this.config.rateLimit.perDay;
    if (perDay && this.dayCount >= perDay) {
      throw new Error(`Mouser local rate limit reached: ${perDay} requests/day.`);
    }

    this.requestTimestamps.push(now);
    this.dayCount += 1;
  }
}

function parsePrice(price: string | undefined): number | undefined {
  if (!price) {
    return undefined;
  }
  const numeric = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseQuantity(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 1;
}

function toCandidate(part: MouserPart): PartCandidate {
  const pricing =
    part.PriceBreaks?.map((priceBreak) => ({
      quantity: parseQuantity(priceBreak.Quantity),
      unitPrice: parsePrice(priceBreak.Price) ?? 0,
      currency: priceBreak.Currency ?? "USD"
    })).filter((priceBreak) => priceBreak.unitPrice > 0) ?? [];

  const normalized: NormalizedPart = {
    supplier: "mouser",
    supplierPartNumber: part.MouserPartNumber ?? "",
    manufacturerPartNumber: part.ManufacturerPartNumber ?? "",
    manufacturer: part.Manufacturer ?? "",
    description: part.Description ?? "",
    categoryPath: part.Category ? [part.Category] : undefined,
    productUrl: part.ProductDetailUrl,
    datasheetUrl: part.DataSheetUrl,
    availability: {
      stockText: part.Availability
    },
    pricing,
    minimumOrderQuantity: part.Min ? Number(part.Min) || undefined : undefined,
    compliance: {
      rohs: part.ROHSStatus?.toLowerCase().includes("compliant") ? "yes" : "unknown"
    },
    specs: specsFromAttributes(part.ProductAttributes),
    source: {
      fetchedAt: new Date().toISOString(),
      supplierApi: "mouser-search-keyword"
    }
  };

  return {
    ...normalized,
    score: scoreMouserCandidate(normalized),
    match: {
      hardConstraintPass: true,
      matched: [],
      missing: [],
      warnings: [],
      reasons: [
        normalized.availability.stockText
          ? `Mouser availability: ${normalized.availability.stockText}`
          : "Mouser returned product metadata"
      ]
    }
  };
}

function specsFromAttributes(
  attributes: MouserPart["ProductAttributes"]
): Record<string, string | number | boolean> {
  const specs: Record<string, string | number | boolean> = {};
  for (const attribute of attributes ?? []) {
    if (!attribute.AttributeName || !attribute.AttributeValue) {
      continue;
    }
    specs[attribute.AttributeName] = attribute.AttributeValue;
  }
  return specs;
}

function scoreMouserCandidate(part: NormalizedPart): number {
  let score = 50;
  if (part.availability.stockText && !part.availability.stockText.toLowerCase().includes("non-stocked")) {
    score += 20;
  }
  if (part.datasheetUrl) {
    score += 10;
  }
  if (part.pricing.length > 0) {
    score += 10;
  }
  if (part.manufacturerPartNumber && part.manufacturer) {
    score += 10;
  }
  return Math.min(score, 100);
}
