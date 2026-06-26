import type { SupplierConfig } from "../../config/env.js";
import type { NormalizedPart, PartCandidate } from "../../normalize/normalized-part.js";

export type DigiKeySearchOptions = {
  query: string;
  limit: number;
  inStockOnly?: boolean;
};

type DigiKeyTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type DigiKeyPriceBreak = {
  BreakQuantity?: number;
  UnitPrice?: number;
  TotalPrice?: number;
};

type DigiKeyProduct = {
  DigiKeyProductNumber?: string;
  ManufacturerProductNumber?: string;
  Manufacturer?: { Name?: string };
  ManufacturerName?: string;
  Description?: { ProductDescription?: string; DetailedDescription?: string };
  ProductDescription?: string;
  DetailedDescription?: string;
  QuantityAvailable?: number;
  ManufacturerLeadWeeks?: string;
  ManufacturerPublicQuantity?: number;
  MinimumOrderQuantity?: number;
  PrimaryDatasheet?: string;
  PrimaryDatasheetUrl?: string;
  ProductUrl?: string;
  ProductStatus?: { Status?: string } | string;
  Category?: { Name?: string; Parent?: { Name?: string } };
  Categories?: Array<{ Name?: string }>;
  PackageType?: { Name?: string };
  StandardPricing?: DigiKeyPriceBreak[];
  ProductVariations?: Array<{
    DigiKeyProductNumber?: string;
    PackageType?: { Name?: string };
    StandardPricing?: DigiKeyPriceBreak[];
    QuantityAvailableforPackageType?: number;
  }>;
  RoHSCompliant?: boolean;
  RohsStatus?: string;
  ReachStatus?: string;
};

type DigiKeyKeywordResponse = {
  Products?: DigiKeyProduct[];
  ExactMatches?: DigiKeyProduct[];
  ProductsCount?: number;
};

export class DigiKeyClient {
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private requestTimestamps: number[] = [];
  private dayKey = "";
  private dayCount = 0;

  constructor(private readonly config: SupplierConfig) {}

  async searchKeyword(options: DigiKeySearchOptions): Promise<{
    candidates: PartCandidate[];
    rawCount: number;
    warnings: string[];
  }> {
    if (!this.config.enabled || !this.config.clientId || !this.config.clientSecret || !this.config.baseUrl) {
      return {
        candidates: [],
        rawCount: 0,
        warnings: ["DigiKey client id or secret is missing."]
      };
    }

    this.assertWithinRateLimit();
    const token = await this.getAccessToken();
    const url = new URL("/products/v4/search/keyword", this.config.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-DIGIKEY-Client-Id": this.config.clientId,
        "X-DIGIKEY-Customer-Id": this.config.customerId ?? "0",
        "X-DIGIKEY-Locale-Site": this.config.locale?.site ?? "US",
        "X-DIGIKEY-Locale-Language": this.config.locale?.language ?? "en",
        "X-DIGIKEY-Locale-Currency": this.config.locale?.currency ?? "USD"
      },
      body: JSON.stringify({
        Keywords: options.query,
        Limit: Math.min(options.limit, 50),
        Offset: 0
      })
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const body = await safeResponseText(response);
      const suffix = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
      throw new Error(`DigiKey ProductInformation V4 returned HTTP ${response.status}.${suffix} ${body}`.trim());
    }

    const payload = (await response.json()) as DigiKeyKeywordResponse;
    const products = [...(payload.ExactMatches ?? []), ...(payload.Products ?? [])];
    const deduped = dedupeProducts(products).slice(0, options.limit);
    const warnings = [];
    if (options.inStockOnly) {
      warnings.push("DigiKey inStockOnly is not pushed into the sandbox KeywordSearch request yet; results are filtered after mapping when possible.");
    }

    const candidates = deduped
      .map((product) => toCandidate(product))
      .filter((candidate) => !options.inStockOnly || (candidate.availability.inStockQuantity ?? 0) > 0);

    return {
      candidates,
      rawCount: payload.ProductsCount ?? products.length,
      warnings
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt - 30_000 > now) {
      return this.accessToken;
    }
    if (!this.config.tokenUrl || !this.config.clientId || !this.config.clientSecret) {
      throw new Error("DigiKey token URL, client id, or client secret is missing.");
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "client_credentials"
      })
    });

    if (!response.ok) {
      const body = await safeResponseText(response);
      throw new Error(`DigiKey OAuth token request returned HTTP ${response.status}. ${body}`.trim());
    }

    const payload = (await response.json()) as DigiKeyTokenResponse;
    if (!payload.access_token) {
      throw new Error("DigiKey OAuth token response did not include access_token.");
    }

    this.accessToken = payload.access_token;
    this.tokenExpiresAt = now + (payload.expires_in ?? 600) * 1000;
    return this.accessToken;
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
        throw new Error(`DigiKey local rate limit reached: ${perMinute} requests/minute.`);
      }
    }

    const perDay = this.config.rateLimit.perDay;
    if (perDay && this.dayCount >= perDay) {
      throw new Error(`DigiKey local rate limit reached: ${perDay} requests/day.`);
    }

    this.requestTimestamps.push(now);
    this.dayCount += 1;
  }
}

function dedupeProducts(products: DigiKeyProduct[]): DigiKeyProduct[] {
  const seen = new Set<string>();
  const deduped = [];
  for (const product of products) {
    const key = product.DigiKeyProductNumber ?? product.ManufacturerProductNumber ?? JSON.stringify(product);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(product);
    }
  }
  return deduped;
}

function safeStatus(status: DigiKeyProduct["ProductStatus"]): string | undefined {
  if (typeof status === "string") {
    return status;
  }
  return status?.Status;
}

function categoryPath(product: DigiKeyProduct): string[] | undefined {
  const categories = product.Categories?.map((category) => category.Name).filter((value): value is string => Boolean(value));
  if (categories?.length) {
    return categories;
  }
  const path = [product.Category?.Parent?.Name, product.Category?.Name].filter((value): value is string => Boolean(value));
  return path.length ? path : undefined;
}

function toCandidate(product: DigiKeyProduct): PartCandidate {
  const pricingSource = product.StandardPricing ?? product.ProductVariations?.find((variation) => variation.StandardPricing)?.StandardPricing ?? [];
  const inStockQuantity =
    product.QuantityAvailable ??
    product.ProductVariations?.find((variation) => typeof variation.QuantityAvailableforPackageType === "number")
      ?.QuantityAvailableforPackageType;

  const normalized: NormalizedPart = {
    supplier: "digikey",
    supplierPartNumber:
      product.DigiKeyProductNumber ?? product.ProductVariations?.find((variation) => variation.DigiKeyProductNumber)?.DigiKeyProductNumber ?? "",
    manufacturerPartNumber: product.ManufacturerProductNumber ?? "",
    manufacturer: product.Manufacturer?.Name ?? product.ManufacturerName ?? "",
    description:
      product.Description?.DetailedDescription ??
      product.Description?.ProductDescription ??
      product.DetailedDescription ??
      product.ProductDescription ??
      "",
    categoryPath: categoryPath(product),
    productUrl: product.ProductUrl,
    datasheetUrl: product.PrimaryDatasheetUrl ?? product.PrimaryDatasheet,
    availability: {
      inStockQuantity,
      stockText: typeof inStockQuantity === "number" ? `${inStockQuantity} available` : undefined,
      leadTime: product.ManufacturerLeadWeeks
    },
    pricing: pricingSource
      .map((priceBreak) => ({
        quantity: priceBreak.BreakQuantity ?? 1,
        unitPrice: priceBreak.UnitPrice ?? 0,
        currency: "USD"
      }))
      .filter((priceBreak) => priceBreak.unitPrice > 0),
    minimumOrderQuantity: product.MinimumOrderQuantity,
    packaging: product.PackageType?.Name ?? product.ProductVariations?.find((variation) => variation.PackageType?.Name)?.PackageType?.Name,
    lifecycleStatus: safeStatus(product.ProductStatus),
    compliance: {
      rohs: product.RoHSCompliant === true || product.RohsStatus?.toLowerCase().includes("compliant") ? "yes" : "unknown",
      reach: product.ReachStatus ? "unknown" : undefined
    },
    specs: {},
    source: {
      fetchedAt: new Date().toISOString(),
      supplierApi: "digikey-productinformation-v4-keyword-sandbox"
    }
  };

  return {
    ...normalized,
    score: scoreDigiKeyCandidate(normalized),
    match: {
      hardConstraintPass: true,
      matched: [],
      missing: [],
      warnings: [],
      reasons: [
        normalized.availability.stockText
          ? `DigiKey availability: ${normalized.availability.stockText}`
          : "DigiKey returned product metadata"
      ]
    }
  };
}

function scoreDigiKeyCandidate(part: NormalizedPart): number {
  let score = 50;
  if ((part.availability.inStockQuantity ?? 0) > 0) {
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

async function safeResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "";
  }
}
