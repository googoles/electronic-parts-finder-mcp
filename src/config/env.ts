import type { SupplierId } from "../suppliers/supplier.js";

export type PartsFinderConfig = {
  cache: {
    ttlSeconds: number;
    dir: string;
  };
  defaults: {
    country: string;
    language: string;
    currency: string;
  };
  suppliers: Record<SupplierId, SupplierConfig>;
};

export type SupplierConfig = {
  enabled: boolean;
  missing: string[];
  baseUrl?: string;
  apiKey?: string;
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  productSearchPath?: string;
  country?: string;
  language?: string;
  currency?: string;
  locale?: {
    site: string;
    language: string;
    currency: string;
  };
  customerId?: string;
  rateLimit: {
    perSecond?: number;
    perMinute?: number;
    perDay?: number;
    source: string;
  };
};

function read(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function missing(names: string[]): string[] {
  return names.filter((name) => read(name) === "");
}

function readOptionalNumber(name: string): number | undefined {
  const value = read(name);
  if (value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function loadConfig(): PartsFinderConfig {
  const mouserMissing = missing(["MOUSER_SEARCH_API_KEY"]);
  const digikeyMissing = missing(["DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"]);
  const aliexpressMissing = missing([
    "ALIEXPRESS_APP_KEY",
    "ALIEXPRESS_APP_SECRET",
    "ALIEXPRESS_ACCESS_TOKEN"
  ]);

  return {
    cache: {
      ttlSeconds: readOptionalNumber("PARTS_FINDER_CACHE_TTL_SECONDS") ?? 300,
      dir: read("PARTS_FINDER_CACHE_DIR", ".cache/parts-finder")
    },
    defaults: {
      country: read("PARTS_FINDER_DEFAULT_COUNTRY", "US"),
      language: read("PARTS_FINDER_DEFAULT_LANGUAGE", "en"),
      currency: read("PARTS_FINDER_DEFAULT_CURRENCY", "USD")
    },
    suppliers: {
      mouser: {
        enabled: mouserMissing.length === 0,
        missing: mouserMissing,
        baseUrl: read("MOUSER_API_BASE_URL", "https://api.mouser.com"),
        apiKey: read("MOUSER_SEARCH_API_KEY"),
        rateLimit: {
          perMinute: readOptionalNumber("MOUSER_RATE_LIMIT_PER_MINUTE"),
          perDay: readOptionalNumber("MOUSER_RATE_LIMIT_PER_DAY"),
          source: "Configured default; verify against current Mouser account/API response headers."
        }
      },
      digikey: {
        enabled: digikeyMissing.length === 0,
        missing: digikeyMissing,
        baseUrl:
          read("DIGIKEY_SANDBOX", "false").toLowerCase() === "true"
            ? read("DIGIKEY_SANDBOX_API_BASE_URL", "https://sandbox-api.digikey.com")
            : read("DIGIKEY_API_BASE_URL", "https://api.digikey.com"),
        clientId: read("DIGIKEY_CLIENT_ID"),
        clientSecret: read("DIGIKEY_CLIENT_SECRET"),
        tokenUrl: read("DIGIKEY_TOKEN_URL", "https://api.digikey.com/v1/oauth2/token"),
        locale: {
          site: read("DIGIKEY_LOCALE_SITE", "US"),
          language: read("DIGIKEY_LOCALE_LANGUAGE", "en"),
          currency: read("DIGIKEY_LOCALE_CURRENCY", "USD")
        },
        customerId: read("DIGIKEY_CUSTOMER_ID", "0"),
        rateLimit: {
          perMinute: readOptionalNumber("DIGIKEY_PRODUCT_INFORMATION_RATE_LIMIT_PER_MINUTE"),
          perDay: readOptionalNumber("DIGIKEY_PRODUCT_INFORMATION_RATE_LIMIT_PER_DAY"),
          source: "DigiKey standard Product Information quota; honor X-RateLimit and Retry-After headers."
        }
      },
      aliexpress: {
        enabled: aliexpressMissing.length === 0,
        missing: aliexpressMissing,
        baseUrl: read("ALIEXPRESS_API_BASE_URL", "https://api-sg.aliexpress.com"),
        appKey: read("ALIEXPRESS_APP_KEY"),
        appSecret: read("ALIEXPRESS_APP_SECRET"),
        accessToken: read("ALIEXPRESS_ACCESS_TOKEN"),
        refreshToken: read("ALIEXPRESS_REFRESH_TOKEN"),
        productSearchPath: read("ALIEXPRESS_PRODUCT_SEARCH_PATH", "/aliexpress/ds/textsearch"),
        country: read("ALIEXPRESS_COUNTRY", "US"),
        currency: read("ALIEXPRESS_CURRENCY", "USD"),
        language: read("ALIEXPRESS_LANGUAGE", "en_US"),
        rateLimit: {
          perSecond: readOptionalNumber("ALIEXPRESS_RATE_LIMIT_PER_SECOND"),
          perDay: readOptionalNumber("ALIEXPRESS_RATE_LIMIT_PER_DAY"),
          source:
            "AliExpress limits vary by appkey, API, and API+appkey; set from Open Platform console after approval."
        }
      }
    }
  };
}
