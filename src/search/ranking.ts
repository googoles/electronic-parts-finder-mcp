import type { z } from "zod";
import type { PartCandidate } from "../normalize/normalized-part.js";
import type { SearchPartsInputSchema } from "../mcp/schemas.js";
import { extractPartFeatures, pitchMatches } from "./part-features.js";
import { withInferredVisualHints } from "./query-intent.js";
import { normalizeSearchQueryForSuppliers, normalizedQueryVariants } from "./query-normalization.js";

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

const lowValueFallbackTokens = new Set([
  "black",
  "blue",
  "gray",
  "green",
  "red",
  "white",
  "yellow",
  "mount",
  "type"
]);

export function buildSearchPlan(input: SearchPartsInput): SearchPlan {
  const plannedInput = withInferredVisualHints(input);
  const notes: string[] = [];
  const queries: string[] = [];
  const originalQuery = cleanWhitespace(plannedInput.query);
  const normalized = normalizeSearchQueryForSuppliers(plannedInput.query);
  const exactish = extractExactishPartNumber(plannedInput.query);
  const joinedPartNumber = extractJoinedPartNumberCandidate(plannedInput.query);
  const addQuery = (query: string | undefined) => {
    const cleaned = cleanWhitespace(query ?? "");
    if (cleaned && !queries.includes(cleaned)) {
      queries.push(cleaned);
    }
  };

  const normalizedQueries = normalizedQueryVariants(plannedInput.query);
  const normalizedChanged = cleanWhitespace(normalized.normalizedQuery) !== originalQuery;
  if (normalizedChanged) {
    for (const query of normalizedQueries) {
      addQuery(query);
    }
    addQuery(originalQuery);
  } else {
    addQuery(originalQuery);
    for (const query of normalizedQueries) {
      addQuery(query);
    }
  }
  if (normalizedQueries.length > 0) {
    notes.push(`Added supplier-friendly normalized query variants: ${normalizedQueries.join(" | ")}`);
  }

  if (joinedPartNumber && joinedPartNumber !== normalizePartNumber(exactish)) {
    addQuery(joinedPartNumber);
    notes.push(`Added joined part-number query from split/OCR text: ${joinedPartNumber}`);
  }

  if (exactish && exactish !== plannedInput.query) {
    addQuery(exactish);
    notes.push(`Added exact-looking part number query: ${exactish}`);
  }

  const visualQueries = visualQueryVariants(plannedInput);
  for (const query of visualQueries) {
    addQuery(query);
  }
  if (visualQueries.length > 0) {
    notes.push(`Added visual connector query variants: ${visualQueries.join(" | ")}`);
  }

  const hintTerms = visualHintTerms(plannedInput);
  if (hintTerms.length > 0) {
    addQuery([plannedInput.query, ...hintTerms.slice(0, 4)].join(" "));
    notes.push(`Expanded query with visual hints: ${hintTerms.slice(0, 4).join(", ")}`);
  }

  if (plannedInput.categoryHint) {
    addQuery([plannedInput.query, plannedInput.categoryHint].join(" "));
    notes.push(`Expanded query with category hint: ${plannedInput.categoryHint}`);
  }

  return {
    queries: queries.slice(0, 4),
    notes
  };
}

export function buildFallbackSearchPlan(input: SearchPartsInput, previousQueries: string[] = []): SearchPlan {
  const plannedInput = withInferredVisualHints(input);
  const previous = new Set(previousQueries.map((query) => cleanWhitespace(query).toLowerCase()));
  const notes: string[] = [];
  const queries: string[] = [];
  const addQuery = (query: string | undefined) => {
    const cleaned = cleanWhitespace(query ?? "");
    if (cleaned && !previous.has(cleaned.toLowerCase()) && !queries.includes(cleaned)) {
      queries.push(cleaned);
    }
  };

  for (const query of relaxedVisualQueryVariants(plannedInput)) {
    addQuery(query);
  }
  addQuery(compactKeywordQuery(plannedInput));

  if (queries.length > 0) {
    notes.push(`Added fallback relaxed queries after no ranked candidates: ${queries.join(" | ")}`);
  }

  return {
    queries: queries.slice(0, 2),
    notes
  };
}

export function rankAndFilterCandidates(
  candidates: PartCandidate[],
  input: SearchPartsInput
): RankedCandidate[] {
  const scoringInput = withInferredVisualHints(input);
  return mergeSupplierCandidates(candidates)
    .map((candidate) => applySearchScoring(candidate, scoringInput))
    .filter((candidate) => candidate.match.hardConstraintPass)
    .sort(compareCandidates)
    .slice(0, scoringInput.limit);
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
  const score = Math.max(0, Math.min(100, evidence.score));
  const matched = unique([...candidate.match.matched, ...evidence.matched]);
  const missing = unique([...candidate.match.missing, ...evidence.missing]);
  const warnings = unique([...candidate.match.warnings, ...evidence.warnings]);
  const reasons = unique([...candidate.match.reasons, ...evidence.reasons]);
  return {
    ...candidate,
    score,
    match: {
      hardConstraintPass: evidence.hardConstraintPass,
      matched,
      missing,
      warnings,
      reasons,
      confidence: confidenceForCandidate(candidate, score, evidence.hardConstraintPass, warnings, missing),
      fitSummary: buildFitSummary(candidate, score, evidence.hardConstraintPass, matched, missing, warnings),
      verificationChecklist: buildVerificationChecklist(candidate, input, matched, missing, warnings)
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
  const queryTokens = primaryQueryTokensForScoring(input);
  const expandedQueryTokens = expandedQueryTokensForScoring(input, queryTokens);
  const exactTargets = exactPartNumberTargets(input.query);
  const exactMatch = exactTargets.find((target) => isLikelyExactPart(candidate, target));

  if (exactMatch) {
    score += 35;
    matched.push(`exact part number: ${exactMatch}`);
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

  const expandedTokenMatches = expandedQueryTokens.filter((token) => haystack.includes(token));
  if (expandedTokenMatches.length > 0) {
    score += Math.min(10, expandedTokenMatches.length * 2);
    matched.push(`expanded query terms: ${expandedTokenMatches.slice(0, 6).join(", ")}`);
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

  const featureMatch = scoreVisualFeatureMatches(candidate, input);
  score += featureMatch.score;
  matched.push(...featureMatch.matched);
  missing.push(...featureMatch.missing);
  warnings.push(...featureMatch.warnings);

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
      hints.connectorRowCount ? `${hints.connectorRowCount} row` : undefined,
      hints.connectorRowCount === 2 ? "dual row" : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm}mm` : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm} mm pitch` : undefined,
      hints.connectorPitchMm && pitchMatches(hints.connectorPitchMm, 2.54) ? "0.100 inch pitch" : undefined,
      hints.connectorGender,
      hints.connectorMountingStyle,
      hints.connectorFamily,
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

function visualQueryVariants(input: SearchPartsInput): string[] {
  const hints = input.visualHints;
  if (!hints) {
    return [];
  }

  const layout = compactConnectorLayout(hints.connectorRowCount, hints.connectorPinCount);
  const familyOrShape = hints.connectorFamily ?? hints.packageShape ?? input.categoryHint;
  const compact = cleanWhitespace(
    [
      layout,
      familyOrShape,
      !familyOrShape && hints.connectorPinCount ? "connector" : undefined,
      hints.connectorPinCount ? `${hints.connectorPinCount} position` : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm}mm pitch` : undefined,
      hints.connectorMountingStyle,
      hints.connectorGender,
      hints.cableWireCount ? `${hints.cableWireCount} wire` : undefined,
      hints.motorHints?.hasEncoder ? "encoder" : undefined,
      hints.motorHints?.gearhead ? "gear motor" : undefined
    ]
      .filter(Boolean)
      .join(" ")
  );
  const baseTerms = [
    layout,
    familyOrShape,
    hints.connectorPinCount ? `${hints.connectorPinCount} pin` : undefined,
    hints.connectorPinCount ? `${hints.connectorPinCount} position` : undefined,
    hints.connectorPitchMm ? `${hints.connectorPitchMm}mm pitch` : undefined,
    hints.connectorMountingStyle,
    hints.connectorGender
  ];
  const primary = cleanWhitespace([input.query, ...baseTerms].filter(Boolean).join(" "));

  const variants = [compact, primary];
  if (hints.connectorPitchMm && pitchMatches(hints.connectorPitchMm, 2.54)) {
    variants.push(
      cleanWhitespace(
        [
          layout,
          familyOrShape,
          !familyOrShape && hints.connectorPinCount ? "connector" : undefined,
          hints.connectorPinCount ? `${hints.connectorPinCount} position` : undefined,
          "0.100 inch pitch",
          hints.connectorMountingStyle,
          hints.connectorGender
        ]
          .filter(Boolean)
          .join(" ")
      )
    );
  }

  return unique(variants.filter((query) => query !== cleanWhitespace(input.query)));
}

function relaxedVisualQueryVariants(input: SearchPartsInput): string[] {
  const hints = input.visualHints;
  if (!hints) {
    return [];
  }

  const familyOrShape = hints.connectorFamily ?? hints.packageShape ?? input.categoryHint;
  const genericFamily = familyOrShape ?? (hints.connectorPinCount || hints.connectorPitchMm ? "connector" : undefined);
  const variants = [
    [
      genericFamily,
      hints.connectorPinCount ? `${hints.connectorPinCount} position` : undefined,
      hints.connectorPitchMm ? `${hints.connectorPitchMm}mm pitch` : undefined
    ],
    [genericFamily, hints.connectorPinCount ? `${hints.connectorPinCount} pin` : undefined],
    [
      hints.motorHints?.hasEncoder ? "encoder" : undefined,
      hints.motorHints?.gearhead ? "gear motor" : undefined,
      hints.motorHints?.connectorType
    ],
    [hints.cableWireCount ? `${hints.cableWireCount} wire` : undefined, genericFamily]
  ].map((parts) => cleanWhitespace(parts.filter(Boolean).join(" ")));

  return unique(variants.filter(Boolean));
}

function compactKeywordQuery(input: SearchPartsInput): string | undefined {
  const normalized = normalizeSearchQueryForSuppliers(input.query);
  const tokens = tokenize([normalized.normalizedQuery, ...normalized.addedTerms, input.categoryHint].filter(Boolean).join(" "))
    .filter((token) => !lowValueFallbackTokens.has(token))
    .slice(0, 6);
  return tokens.length >= 2 ? tokens.join(" ") : undefined;
}

function primaryQueryTokensForScoring(input: SearchPartsInput): string[] {
  const normalized = normalizeSearchQueryForSuppliers(input.query);
  return tokenize(normalized.normalizedQuery || input.query);
}

function expandedQueryTokensForScoring(input: SearchPartsInput, primaryTokens: string[]): string[] {
  const normalized = normalizeSearchQueryForSuppliers(input.query);
  return unique(
    [
      ...normalized.addedTerms.flatMap((term) => tokenize(term)),
      ...visualHintTerms(input).flatMap((term) => tokenize(term)),
      ...tokenize(input.categoryHint ?? "")
    ].filter((token) => token.length >= 2)
  ).filter((token) => !primaryTokens.includes(token));
}

function compactConnectorLayout(rowCount: number | undefined, pinCount: number | undefined): string | undefined {
  if (!rowCount || !pinCount || pinCount % rowCount !== 0) {
    return undefined;
  }
  return `${rowCount}x${pinCount / rowCount}`;
}

function scoreVisualFeatureMatches(candidate: PartCandidate, input: SearchPartsInput): {
  score: number;
  matched: string[];
  missing: string[];
  warnings: string[];
} {
  const hints = input.visualHints;
  if (!hints) {
    return { score: 0, matched: [], missing: [], warnings: [] };
  }

  const features = extractPartFeatures(candidate);
  let score = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const expectedPinCount = hints.connectorPinCount ?? hints.pinCount;
  if (expectedPinCount) {
    if (features.pinCounts.includes(expectedPinCount)) {
      score += 14;
      matched.push(`pin/position count: ${expectedPinCount}`);
    } else if (features.pinCounts.length > 0) {
      score -= 10;
      missing.push(`pin/position count ${expectedPinCount}; candidate has ${features.pinCounts.join(", ")}`);
    }
  }

  if (hints.connectorRowCount) {
    if (features.rowCounts.includes(hints.connectorRowCount)) {
      score += 8;
      matched.push(`row count: ${hints.connectorRowCount}`);
    } else if (features.rowCounts.length > 0) {
      score -= 5;
      missing.push(`row count ${hints.connectorRowCount}; candidate has ${features.rowCounts.join(", ")}`);
    }
  }

  if (hints.connectorPitchMm) {
    const pitchMatch = features.pitchMm.find((pitch) => pitchMatches(pitch, hints.connectorPitchMm ?? 0));
    if (pitchMatch) {
      score += 14;
      matched.push(`pitch: ${pitchMatch}mm`);
    } else if (features.pitchMm.length > 0) {
      score -= 8;
      missing.push(`pitch ${hints.connectorPitchMm}mm; candidate has ${features.pitchMm.join(", ")}mm`);
    }
  }

  if (hints.connectorMountingStyle) {
    const expected = normalizeText(hints.connectorMountingStyle);
    const hit = features.mountingStyles.some((style) => normalizeText(style).includes(expected) || expected.includes(normalizeText(style)));
    if (hit) {
      score += 8;
      matched.push(`mounting style: ${hints.connectorMountingStyle}`);
    } else if (features.mountingStyles.length > 0) {
      warnings.push(`Mounting style may differ: expected ${hints.connectorMountingStyle}, candidate hints ${features.mountingStyles.join(", ")}.`);
    }
  }

  if (hints.connectorGender) {
    const expected = normalizeText(hints.connectorGender);
    const hit = features.genders.some((gender) => normalizeText(gender).includes(expected) || expected.includes(normalizeText(gender)));
    if (hit) {
      score += 6;
      matched.push(`connector gender/type: ${hints.connectorGender}`);
    }
  }

  if (hints.connectorFamily) {
    const expected = normalizeText(hints.connectorFamily);
    const hit = features.connectorFamilies.some((family) => normalizeText(family).includes(expected) || expected.includes(normalizeText(family)));
    if (hit) {
      score += 8;
      matched.push(`connector family: ${hints.connectorFamily}`);
    }
  }

  return {
    score,
    matched,
    missing,
    warnings
  };
}

function confidenceForCandidate(
  candidate: PartCandidate,
  score: number,
  hardConstraintPass: boolean,
  warnings: string[],
  missing: string[]
): "high" | "medium" | "low" {
  if (candidate.marketplace) {
    return score >= 70 && hardConstraintPass ? "medium" : "low";
  }
  if (!hardConstraintPass || missing.length >= 3 || warnings.some((warning) => /marketplace|lifecycle|obsolete|discontinued/i.test(warning))) {
    return score >= 80 && hardConstraintPass ? "medium" : "low";
  }
  if (score >= 85) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  return "low";
}

function buildFitSummary(
  candidate: PartCandidate,
  score: number,
  hardConstraintPass: boolean,
  matched: string[],
  missing: string[],
  warnings: string[]
): string {
  const confidence = confidenceForCandidate(candidate, score, hardConstraintPass, warnings, missing);
  const strengths = matched.slice(0, 3).join("; ") || "supplier returned product metadata";
  const caveats = [...missing, ...warnings].slice(0, 2).join("; ");
  const prefix = `${confidence} confidence, score ${score}`;
  const identity = [candidate.manufacturer, candidate.manufacturerPartNumber || candidate.supplierPartNumber]
    .filter(Boolean)
    .join(" ");
  return caveats
    ? `${prefix}: ${identity || candidate.description} matched ${strengths}. Check ${caveats}.`
    : `${prefix}: ${identity || candidate.description} matched ${strengths}.`;
}

function buildVerificationChecklist(
  candidate: PartCandidate,
  input: SearchPartsInput,
  matched: string[],
  missing: string[],
  warnings: string[]
): string[] {
  const checklist = new Set<string>();
  const hints = input.visualHints;

  if (candidate.manufacturerPartNumber || candidate.supplierPartNumber) {
    checklist.add("Verify exact manufacturer and supplier part numbers on the supplier product page.");
  }
  if (hints?.connectorPinCount || matched.some((item) => /pin|position/i.test(item)) || missing.some((item) => /pin|position/i.test(item))) {
    checklist.add("Verify connector pin/position count against the datasheet or measured part.");
  }
  if (hints?.connectorPitchMm || matched.some((item) => /pitch/i.test(item)) || missing.some((item) => /pitch/i.test(item))) {
    checklist.add("Verify pitch, row count, gender/type, keying, latch, and mounting style before purchase.");
  }
  if (input.constraints?.mustHave?.length || input.constraints?.mustNotHave?.length) {
    checklist.add("Verify all must-have and forbidden terms against official specifications.");
  }
  if (candidate.datasheetUrl) {
    checklist.add("Open the datasheet and confirm electrical, mechanical, and environmental ratings.");
  } else {
    checklist.add("Find an official datasheet or manufacturer page before final selection.");
  }
  if (candidate.availability.inStockQuantity !== undefined || candidate.availability.stockText) {
    checklist.add("Confirm stock quantity, packaging, MOQ, lead time, and price breaks at the requested order quantity.");
  }
  if (candidate.lifecycleStatus || warnings.some((warning) => /lifecycle|obsolete|discontinued/i.test(warning))) {
    checklist.add("Check lifecycle status and recommended replacement notices.");
  }
  if (candidate.marketplace || warnings.some((warning) => /marketplace/i.test(warning))) {
    checklist.add("For marketplace listings, verify seller reputation, exact variant/options, authenticity, shipping, and return terms.");
  }
  if (candidate.compliance?.rohs || input.constraints?.rohsOnly) {
    checklist.add("Confirm RoHS/REACH compliance documents when compliance matters.");
  }
  return Array.from(checklist).slice(0, 8);
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

function exactPartNumberTargets(value: string): string[] {
  return unique([extractJoinedPartNumberCandidate(value), extractExactishPartNumber(value)].filter((target): target is string => Boolean(target)));
}

function extractJoinedPartNumberCandidate(value: string): string | undefined {
  const tokens = value.match(/\b[A-Z0-9]{2,10}\b/gi) ?? [];
  const partTokens = tokens
    .map((token) => token.toUpperCase())
    .filter((token) => /[A-Z]/.test(token) && !isUnitLikeToken(token));
  if (partTokens.length < 2 || partTokens.length > 5) {
    return undefined;
  }

  const joined = partTokens.join("");
  if (joined.length < 8 || joined.length > 32 || !/[A-Z]{2,}/.test(joined) || !/\d{2,}/.test(joined)) {
    return undefined;
  }
  return joined;
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
