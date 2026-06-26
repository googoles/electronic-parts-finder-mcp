import type { z } from "zod";
import type { SearchPartsInputSchema } from "../mcp/schemas.js";

export const supplierIds = ["mouser", "digikey", "aliexpress"] as const;
export type SupplierId = (typeof supplierIds)[number];

export type SupplierStatus = {
  supplier: SupplierId;
  enabled: boolean;
  missingCredentials: string[];
  rateLimit: {
    perSecond?: number;
    perMinute?: number;
    perDay?: number;
    source: string;
  };
  note?: string;
};

export type SearchPartsInput = z.infer<typeof SearchPartsInputSchema>;
