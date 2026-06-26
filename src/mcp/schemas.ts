import { z } from "zod";
import { supplierIds } from "../suppliers/supplier.js";

const SupplierSchema = z.enum(supplierIds);

export const VisualPartHintsSchema = z
  .object({
    visibleText: z.array(z.string()).optional(),
    packageShape: z.string().optional(),
    pinCount: z.number().int().positive().optional(),
    pinLayout: z.string().optional(),
    connectorPinCount: z.number().int().positive().optional(),
    connectorPitchMm: z.number().positive().optional(),
    color: z.array(z.string()).optional(),
    dimensionsMm: z
      .object({
        length: z.number().positive().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional()
      })
      .optional(),
    boardContext: z.array(z.string()).optional(),
    cableWireCount: z.number().int().positive().optional(),
    motorHints: z
      .object({
        shaftDiameterMm: z.number().positive().optional(),
        bodyDiameterMm: z.number().positive().optional(),
        bodyLengthMm: z.number().positive().optional(),
        connectorType: z.string().optional(),
        hasEncoder: z.boolean().optional(),
        gearhead: z.boolean().optional()
      })
      .optional(),
    imageQuality: z.enum(["clear", "partial", "blurry", "low_resolution"]).optional(),
    confidence: z.number().min(0).max(1).optional(),
    notes: z.array(z.string()).optional()
  })
  .strict();

export const ConstraintsSchema = z
  .object({
    manufacturer: z.array(z.string()).optional(),
    mustHave: z.array(z.string()).optional(),
    mustNotHave: z.array(z.string()).optional(),
    inStockOnly: z.boolean().optional(),
    marketplaceAllowed: z.boolean().optional(),
    maxUnitPrice: z.number().positive().optional(),
    maxMoq: z.number().int().positive().optional(),
    maxShippingDays: z.number().int().positive().optional(),
    rohsOnly: z.boolean().optional()
  })
  .strict()
  .optional();

export const SearchPartsInputSchema = z.object({
  query: z.string().min(1),
  categoryHint: z.string().optional(),
  suppliers: z.array(SupplierSchema).optional(),
  constraints: ConstraintsSchema,
  visualHints: VisualPartHintsSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10)
});

export const ExtractVisualPartHintsInputSchema = VisualPartHintsSchema.extend({
  userGoal: z.string().optional()
});

export const LookupPartInputSchema = z.object({
  partNumber: z.string().min(1),
  kind: z.enum(["auto", "manufacturer", "supplier"]).default("auto"),
  supplier: SupplierSchema.optional()
});

export const ComparePartsInputSchema = z.object({
  parts: z.array(z.string().min(1)).min(2).max(10),
  criteria: z.array(z.string()).optional()
});

export const SuggestAlternatesInputSchema = z.object({
  partNumber: z.string().min(1),
  reason: z
    .enum(["out_of_stock", "obsolete", "price", "lead_time", "second_source", "unknown"])
    .default("unknown"),
  mustMatch: z.array(z.string()).optional()
});

export const EnrichBomInputSchema = z.object({
  items: z
    .array(
      z.object({
        refdes: z.string().optional(),
        partNumber: z.string().min(1),
        manufacturer: z.string().optional(),
        quantity: z.number().int().positive().default(1)
      })
    )
    .min(1),
  suppliers: z.array(SupplierSchema).optional(),
  pricingQuantity: z.number().int().positive().optional()
});
