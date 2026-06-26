import { createHmac } from "node:crypto";
import type { SupplierConfig } from "../../config/env.js";
import type { NormalizedPart, PartCandidate } from "../../normalize/normalized-part.js";

export type AliExpressSearchOptions = {
  query: string;
  limit: number;
  marketplaceAllowed?: boolean;
};

type AliExpressProduct = {
  product_id?: string | number;
  item_id?: string | number;
  productId?: string | number;
  title?: string;
  product_title?: string;
  subject?: string;
  product_main_image_url?: string;
  product_detail_url?: string;
  product_url?: string;
  target_sale_price?: string;
  sale_price?: string;
  app_sale_price?: string;
  original_price?: string;
  target_sale_price_currency?: string;
  sale_price_currency?: string;
  currency?: string;
  orders?: string | number;
  order_count?: string | number;
  evaluate_rate?: string;
  product_rating?: string | number;
  shop_name?: string;
  store_name?: string;
  shipping_delivery_days?: string | number;
  category_name?: string;
};

type AliExpressEnvelope = {
  error_response?: { code?: string | number; msg?: string; sub_msg?: string };
  rsp_msg?: string;
  rsp_code?: string | number;
  result?: unknown;
  resp_result?: { result?: unknown };
  products?: unknown;
};

export class AliExpressClient {
  private requestTimestamps: number[] = [];
  private dayKey = "";
  private dayCount = 0;

  constructor(private readonly config: SupplierConfig) {}

  async searchKeyword(options: AliExpressSearchOptions): Promise<{
    candidates: PartCandidate[];
    rawCount: number;
    warnings: string[];
  }> {
    if (!options.marketplaceAllowed) {
      return {
        candidates: [],
        rawCount: 0,
        warnings: ["AliExpress skipped because marketplaceAllowed is false."]
      };
    }
    if (
      !this.config.enabled ||
      !this.config.baseUrl ||
      !this.config.appKey ||
      !this.config.appSecret ||
      !this.config.accessToken ||
      !this.config.productSearchPath
    ) {
      return {
        candidates: [],
        rawCount: 0,
        warnings: ["AliExpress app key, secret, access token, or product search path is missing."]
      };
    }

    this.assertWithinRateLimit();
    const payload = await this.signedRequest(this.config.productSearchPath, {
      keywords: options.query,
      keyWord: options.query,
      page_size: String(Math.min(options.limit, 50)),
      pageSize: String(Math.min(options.limit, 50)),
      page_no: "1",
      pageIndex: "1",
      target_currency: this.config.currency ?? "USD",
      currency: this.config.currency ?? "USD",
      ship_to_country: this.config.country ?? "US",
      countryCode: this.config.country ?? "US",
      target_language: this.config.language ?? "en_US",
      locale: this.config.language ?? "en_US"
    });

    const products = extractProducts(payload).slice(0, options.limit);
    return {
      candidates: products.map((product) => toCandidate(product, this.config.currency ?? "USD")),
      rawCount: products.length,
      warnings: [
        "AliExpress marketplace results are lower confidence than authorized distributor results; verify authenticity, ratings, shipping, and seller details before use."
      ]
    };
  }

  private async signedRequest(path: string, requestParams: Record<string, string>): Promise<AliExpressEnvelope> {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "+0000");
    const params: Record<string, string> = {
      ...requestParams,
      access_token: this.config.accessToken ?? "",
      app_key: this.config.appKey ?? "",
      sign_method: "sha256",
      timestamp
    };
    params.sign = signAliExpressRequest(path, params, this.config.appSecret ?? "");

    const url = new URL(path, this.config.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(params)
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const body = await safeResponseText(response);
      const suffix = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
      throw new Error(`AliExpress Open Platform returned HTTP ${response.status}.${suffix} ${body}`.trim());
    }

    const payload = (await response.json()) as AliExpressEnvelope;
    const apiError = payload.error_response;
    if (apiError) {
      throw new Error(
        `AliExpress Open Platform error: ${[apiError.code, apiError.msg, apiError.sub_msg]
          .filter(Boolean)
          .join(" ")}`
      );
    }
    if (payload.rsp_code && String(payload.rsp_code) !== "200") {
      throw new Error(`AliExpress Open Platform error: ${payload.rsp_code} ${payload.rsp_msg ?? ""}`.trim());
    }
    return payload;
  }

  private assertWithinRateLimit(): void {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.dayKey !== today) {
      this.dayKey = today;
      this.dayCount = 0;
    }

    const perSecond = this.config.rateLimit.perSecond;
    if (perSecond) {
      const oneSecondAgo = now - 1000;
      this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > oneSecondAgo);
      if (this.requestTimestamps.length >= perSecond) {
        throw new Error(`AliExpress local rate limit reached: ${perSecond} requests/second.`);
      }
    }

    const perDay = this.config.rateLimit.perDay;
    if (perDay && this.dayCount >= perDay) {
      throw new Error(`AliExpress local rate limit reached: ${perDay} requests/day.`);
    }

    this.requestTimestamps.push(now);
    this.dayCount += 1;
  }
}

export function signAliExpressRequest(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  appSecret: string
): string {
  const sorted = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && value !== undefined && value !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  const signingText = `${path}${sorted.map(([key, value]) => `${key}${String(value)}`).join("")}`;
  return createHmac("sha256", appSecret).update(signingText, "utf8").digest("hex").toUpperCase();
}

function extractProducts(payload: AliExpressEnvelope): AliExpressProduct[] {
  const containers = [
    payload.result,
    payload.resp_result?.result,
    payload.products
  ];
  for (const container of containers) {
    const products = findProductArray(container);
    if (products.length > 0) {
      return products;
    }
  }
  return [];
}

function findProductArray(value: unknown): AliExpressProduct[] {
  if (Array.isArray(value)) {
    return value.filter(isProductLike);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const likelyKeys = [
    "products",
    "product",
    "product_list",
    "aeop_ae_product_list",
    "items",
    "results"
  ];
  for (const key of likelyKeys) {
    const nested = findProductArray(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }
  for (const nested of Object.values(record)) {
    const products = findProductArray(nested);
    if (products.length > 0) {
      return products;
    }
  }
  return [];
}

function isProductLike(value: unknown): value is AliExpressProduct {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as AliExpressProduct;
  return Boolean(record.product_id ?? record.item_id ?? record.productId ?? record.title ?? record.product_title ?? record.subject);
}

function toCandidate(product: AliExpressProduct, defaultCurrency: string): PartCandidate {
  const productId = String(product.product_id ?? product.item_id ?? product.productId ?? "");
  const title = product.title ?? product.product_title ?? product.subject ?? "";
  const unitPrice = parsePrice(product.target_sale_price ?? product.sale_price ?? product.app_sale_price ?? product.original_price);
  const currency = product.target_sale_price_currency ?? product.sale_price_currency ?? product.currency ?? defaultCurrency;

  const normalized: NormalizedPart = {
    supplier: "aliexpress",
    supplierPartNumber: productId,
    manufacturerPartNumber: "",
    manufacturer: product.shop_name ?? product.store_name ?? "AliExpress seller",
    description: title,
    categoryPath: product.category_name ? [product.category_name] : undefined,
    productUrl: product.product_detail_url ?? product.product_url,
    availability: {
      stockText: "Marketplace listing; stock varies by seller/options.",
      leadTime: product.shipping_delivery_days ? `${product.shipping_delivery_days} shipping days` : undefined
    },
    pricing: unitPrice
      ? [
          {
            quantity: 1,
            unitPrice,
            currency
          }
        ]
      : [],
    marketplace: {
      sellerName: product.shop_name ?? product.store_name,
      orderCount: parseNumber(product.orders ?? product.order_count),
      productRating: parseNumber(product.product_rating ?? product.evaluate_rate)
    },
    specs: {},
    source: {
      fetchedAt: new Date().toISOString(),
      supplierApi: "aliexpress-open-platform-search"
    }
  };

  return {
    ...normalized,
    score: scoreAliExpressCandidate(normalized),
    match: {
      hardConstraintPass: true,
      matched: title ? ["marketplace title returned"] : [],
      missing: [],
      warnings: [
        "Marketplace candidate; verify authenticity, dimensions, variant/options, shipping, and seller reputation before use."
      ],
      reasons: ["AliExpress returned marketplace product metadata."]
    }
  };
}

function scoreAliExpressCandidate(part: NormalizedPart): number {
  let score = 30;
  if (part.productUrl) {
    score += 8;
  }
  if (part.pricing.length > 0) {
    score += 8;
  }
  if ((part.marketplace?.orderCount ?? 0) > 0) {
    score += 8;
  }
  if ((part.marketplace?.productRating ?? 0) >= 4.5) {
    score += 6;
  }
  return Math.min(score, 65);
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!value) {
    return undefined;
  }
  const numeric = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "";
  }
}
