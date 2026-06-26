import type { SupplierId } from "../suppliers/supplier.js";

export type NormalizedPart = {
  supplier: SupplierId;
  supplierPartNumber: string;
  manufacturerPartNumber: string;
  manufacturer: string;
  description: string;
  categoryPath?: string[];
  productUrl?: string;
  datasheetUrl?: string;
  availability: {
    inStockQuantity?: number;
    stockText?: string;
    leadTime?: string;
  };
  pricing: Array<{
    quantity: number;
    unitPrice: number;
    currency: string;
  }>;
  minimumOrderQuantity?: number;
  packaging?: string;
  lifecycleStatus?: string;
  compliance?: {
    rohs?: "yes" | "no" | "unknown";
    reach?: "yes" | "no" | "unknown";
  };
  marketplace?: {
    sellerName?: string;
    sellerRating?: number;
    orderCount?: number;
    productRating?: number;
  };
  specs: Record<string, string | number | boolean>;
  source: {
    fetchedAt: string;
    supplierApi: string;
  };
};

export type PartCandidate = NormalizedPart & {
  score: number;
  match: {
    hardConstraintPass: boolean;
    matched: string[];
    missing: string[];
    warnings: string[];
    reasons: string[];
  };
};
