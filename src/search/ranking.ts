import type { z } from "zod";
import type { PartCandidate } from "../normalize/normalized-part.js";
import type { SearchPartsInputSchema } from "../mcp/schemas.js";

type SearchPartsInput = z.infer<typeof SearchPartsInputSchema>;

export type RankedCandidate = PartCandidate;

export type SearchPlan = {
  queries: string[];
  notes: string[];
};

type MatchEvidence = {
  score: number;
  matched: string[];
  missing: string[];
  warnings: string[];
  reasons: string[];
  hardConstraintPass: boolean;
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

export function buildSearchPlan(input: SearchPartsInput): SearchPlan {
  const notes: string[] = [];
  const queries = new Set<string>();
  queries.add(cleanWhitespace(input.query));

  const hintTerms = visualHintTerms(input);
  if (hintTerms.length > 0) {
    queries.add(cleanWhitespace([input.query, ...hintTerms.slice(0, 4)].join(" ")));
    notes.push(`Expanded query with visual hints: ${hintTerms.slice(0, 4).join(", ")}`);
  }

  if (input.categoryHint) {
    queries.add(cleanWhitespace([input.query, input.categoryHint].join(" ")));
    notes.push(`Expanded query with category hint: ${input.categoryHint}`);
  }

  const exactish = extractExactishPartNumber(input.query);
  if (exactish && exactish !== input.query) {
    queries.add(exactish);
    notes.push(`Added exact-looking part number query: ${exactish}`);
  }

  return {
    queries: Array.from(queries).filter(Boolean).slice(0, 3),
    notes
  };
}

export function rankAndFilterCandidates(
  candidates: PartCandidate[],
  input: SearchPartsInput
): RankedCandidate[] {
  return mergeSupplierCandidates(candidates)
    .map((candidate) => applySearchScoring(candidate, input))
    .filter((candidate) => candidate.match.hardConstraintPass)
    .sort(compareCandidates)
    .slice(0, input.limit);
}

export function bestUnitPrice(candidate: PartCandidate, quantity = 1): number | undefined {
  const eligible = candidate.pricing
    .filter((price) => price.quantity <= quantity)
    .sort((a, b) => b.quantity - a.quantity);
  return eligible[0]?.unitPrice ?? candidate.pricing[0]?.unitPrice;
}

export function normalizedPartKey(candidate: PartCandidate): string {
  const mpn = normalizePartNumber(candidate.manufacturerPartNumber);
  if (mpn) {
    return `${normalizeText(candidate.manufacturer)}::${mpn}`;
  }
  return `${candidate.supplier}::${normalizePartNumber(candidate.supplierPartNumber)}`;
}

export function isLikelyExactPart(candidate: PartCandidate, partNumber: string): boolean {
  const target = normalizePartNumber(partNumber);
  return Boolean(
    target &&
      (normalizePartNumber(candidate.manufacturerPartNumber) === target ||
        normalizePartNumber(candidate.supplierPartNumber) === target)
  );
}

export function compareCandidates(a: PartCandidate, b: PartCandidate): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const aStock = a.availability.inStockQuantity ?? 0;
  const bStock = b.availability.inStockQuantity ?? 0;
  if (bStock !== aStock) {
    return bStock - aStock;
  }
  return (bestUnitPrice(a) ?? Number.POSITIVE_INFINITY) - (bestUnitPrice(b) ?? Number.POSITIVE_INFINITY);
}

function applySearchScoring(candidate: PartCandidate, input: SearchPartsInput): RankedCandidate {
  const evidence = scoreCandidate(candidate, input);
  return {
    ...candidate,
    score: Math.max(0, Math.min(100, evidence.score)),
    match: {
      hardConstraintPass: evidence.hardConstraintPass,
      matched: unique([...candidate.match.matched, ...evidence.matched]),
      missing: unique([...candidate.match.missing, ...evidence.missing]),
      warnings: unique([...candidate.match.warnings, ...evidence.warnings]),
      reasons: unique([...candidate.match.reasons, ...evidence.reasons])
    }
  };
}

function scoreCandidate(candidate: PartCandidate, input: SearchPartsInput): MatchEvidence {
  let score = 20;
  const matched: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];
  let hardConstraintPass = true;

  const haystack = normalizeText(
    [
      candidate.manufacturer,
      candidate.manufacturerPartNumber,
      candidate.supplierPartNumber,
      candidate.description,
      candidate.categoryPath?.join(" "),
      candidate.lifecycleStatus,
      candidate.packaging,
      Object.values(candidate.specs).join(" ")
    ].join(" ")
  );
  const queryTokens = tokenize(input.query);
  const exactish = extractExactishPartNumber(input.query);

  if (exactish && isLikelyExactPart(candidate, exactish)) {
    score += 35;
    matched.push(`exact part number: ${exactish}`);
    reasons.push("Exact manufacturer or supplier part number matched.");
  }

  const tokenMatches = queryTokens.filter((token) => haystack.includes(token));
  if (queryTokens.length > 0) {
    const ratio = tokenMatches.length / queryTokens.length;
    score += Math.round(ratio * 25);
    if (tokenMatches.length > 0) {
      matched.push(`query terms: ${tokenMatches.join(", ")}`);
    }
    const importantMissing = queryTokens.filter((token) => !tokenMatches.includes(token) && token.length >= 4);
    if (importantMissing.length > 0) {
      missing.push(`query terms: ${importantMissing.slice(0, 5).join(", ")}`);
    }
  }

  const constraints = input.constraints;
  if (constraints?.manufacturer?.length) {
    const manufacturerHit = constraints.manufacturer.some((manufacturer) =>
      normalizeText(candidate.manufacturer).includes(normalizeText(manufacturer))
    );
    if (manufacturerHit) {
      score += 15;
      matched.push(`manufacturer: ${candidate.manufacturer}`);
    } else {
      hardConstraintPass = false;
      missing.push(`manufacturer must be one of: ${constraints.manufacturer.join(", ")}`);
    }
  }

  for (const term of constraints?.mustHave ?? []) {
    if (haystack.includes(normalizeText(term))) {
      score += 6;
      matched.push(`mustHave: ${term}`);
    } else {
      hardConstraintPass = false;
      missing.push(`mustHave: ${term}`);
    }
  }

  for (const term of constraints?.mustNotHave ?? []) {
    if (haystack.includes(normalizeText(term))) {
      hardConstraintPass = false;
      warnings.push(`mustNotHave term found: ${term}`);
    }
  }

  const stock = candidate.availability.inStockQuantity;
  if (constraints?.inStockOnly && typeof stock === "number" && stock <= 0) {
    hardConstraintPass = false;
    missing.push("in-stock quantity");
  } else if ((stock ?? 0) > 0 || positiveStockText(candidate.availability.stockText)) {
    score += 12;
    matched.push("available stock");
  }

  const unitPrice = bestUnitPrice(candidate);
  if (constraints?.maxUnitPrice && typeof unitPrice === "number") {
    if (unitPrice <= constraints.maxUnitPrice) {
      score += 8;
      matched.push(`unit price <= ${constraints.maxUnitPrice}`);
    } else {
      hardConstraintPass = false;
      missing.push(`unit price <= ${constraints.maxUnitPrice}`);
    }
  } else if (typeof unitPrice === "number") {
    score += 5;
  }

  if (constraints?.maxMoq && typeof candidate.minimumOrderQuantity === "number") {
    if (candidate.minimumOrderQuantity <= constraints.maxMoq) {
      score += 5;
      matched.push(`MOQ <= ${constraints.maxMoq}`);
    } else {
      hardConstraintPass = false;
      missing.push(`MOQ <= ${constraints.maxMoq}`);
    }
  }

  if (constraints?.rohsOnly) {
    if (candidate.compliance?.rohs === "yes") {
      score += 7;
      matched.push("RoHS compliant");
    } else {
      hardConstraintPass = false;
      missing.push("RoHS compliance");
    }
  }

  const visualTerms = visualHintTerms(input);
  const visualMatches = visualTerms.filter((term) => haystack.includes(normalizeText(term)));
  if (visualMatches.length > 0) {
    score += Math.min(18, visualMatches.length * 5);
    matched.push(`visual hints: ${visualMatches.join(", ")}`);
  }

  if (candidate.datasheetUrl) {
    score += 6;
    matched.push("datasheet available");
  }
  if (candidate.productUrl) {
    score += 4;
  }
  if (candidate.lifecycleStatus && /obsolete|discontinued|not for new/i.test(candidate.lifecycleStatus)) {
    score -= 20;
    warnings.push(`Lifecycle caveat: ${candidate.lifecycleStatus}`);
  }
  if (candidate.marketplace && !constraints?.marketplaceAllowed) {
    score -= 25;
    warnings.push("Marketplace result is lower confidence unless marketplaceAllowed is true.");
  }

  return {
    score,
    matched,
    missing,
    warnings,
    reasons,
    hardConstraintPass
  };
}

function mergeSupplierCandidates(candidates: PartCandidate[]): PartCandidate[] {
  const merged = new Map<string, PartCandidate>();
  for (const candidate of candidates) {
    const key = normalizedPartKey(candidate);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      continue;
    }

    const better = compareSupplierMetadata(existing, candidate) <= 0 ? existing : candidate;
    merged.set(key, {
      ...better,
      pricing: [...existing.pricing, ...candidate.pricing].sort((a, b) => a.quantity - b.quantity),
      availability: {
        inStockQuantity: Math.max(existing.availability.inStockQuantity ?? 0, candidate.availability.inStockQuantity ?? 0) || undefined,
        stockText: unique([existing.availability.stockText, candidate.availability.stockText].filter((value): value is string => Boolean(value))).join(" | ") || undefined,
        leadTime: existing.availability.leadTime ?? candidate.availability.leadTime
      },
      match: {
        hardConstraintPass: existing.match.hardConstraintPass && candidate.match.hardConstraintPass,
        matched: unique([...existing.match.matched, ...candidate.match.matched]),
        missing: unique([...existing.match.missing, ...candidate.match.missing]),
        warnings: unique([...existing.match.warnings, ...candidate.match.warnings]),
        reasons: unique([
          ...existing.match.reasons,
          ...candidate.match.reasons,
          `Merged supplier result from ${existing.supplier} and ${candidate.supplier}.`
        ])
      }
    });
  }
  return Array.from(merged.values());
}

function compareSupplierMetadata(a: PartCandidate, b: PartCandidate): number {
  return metadataCompleteness(b) - metadataCompleteness(a);
}

function metadataCompleteness(candidate: PartCandidate): number {
  return [
    candidate.manufacturerPartNumber,
    candidate.manufacturer,
    candidate.description,
    candidate.productUrl,
    candidate.datasheetUrl,
    candidate.categoryPath?.length,
    candidate.pricing.length,
    candidate.availability.inStockQuantity
  ].filter(Boolean).length;
}

function visualHintTerms(input: Pick<SearchPartsInput, "visualHints" | "categoryHint">): string[] {
  const hints = input.visualHints;
  if (!hints) {
    return [];
  }

  return unique(
    [
      hints.packageShape,
      hints.pinCount ? `${hints.pinCount} pin` : undefined,
      hints.pinLayout,
      hints.connectorPinCount ? `${hints.connectorPinCount} pin` : undefined,
      hints.connectorPinCount ? `${hints.connectorPinCount} position` : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm}mm` : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm} mm pitch` : undefined,
      hints.cableWireCount ? `${hints.cableWireCount} wire` : undefined,
      hints.motorHints?.hasEncoder ? "encoder" : undefined,
      hints.motorHints?.gearhead ? "gear motor" : undefined,
      hints.motorHints?.connectorType,
      ...(hints.color ?? []),
      ...(hints.boardContext ?? []),
      input.categoryHint
    ].filter((term): term is string => Boolean(term))
  );
}

function positiveStockText(stockText: string | undefined): boolean {
  if (!stockText) {
    return false;
  }
  return !/no stock|non-stock|unavailable|0\s+available/i.test(stockText);
}

function extractExactishPartNumber(value: string): string | undefined {
  const candidates = value.match(/\b[A-Z0-9][A-Z0-9._/-]{2,}[A-Z0-9]\b/gi) ?? [];
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => /[0-9]/.test(candidate) && /[A-Z]/i.test(candidate) && !isUnitLikeToken(candidate))
    .sort((a, b) => b.length - a.length)[0];
}

function isUnitLikeToken(value: string): boolean {
  return /^\d+(\.\d+)?\s*(mm|cm|m|in|v|vdc|vac|a|ma|w|kw|hz|khz|mhz|ghz|ohm|pf|nf|uf)$/i.test(value);
}

function tokenize(value: string): string[] {
  return unique(
    normalizeText(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopWords.has(token))
  );
}

function normalizeText(value: string | undefined): string {
  return cleanWhitespace(value ?? "")
    .toLowerCase()
    .replace(/[_/(),;:]+/g, " ")
    .replace(/[^a-z0-9.+-]+/g, " ")
    .trim();
}

function normalizePartNumber(value: string | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
