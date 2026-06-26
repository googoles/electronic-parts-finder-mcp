import type { z } from "zod";
import type { SearchPartsInputSchema } from "../mcp/schemas.js";
import { normalizeSearchQueryForSuppliers, normalizedQueryVariants } from "./query-normalization.js";

type SearchPartsInput = z.infer<typeof SearchPartsInputSchema>;
type VisualPartHints = NonNullable<SearchPartsInput["visualHints"]>;

type IntentText = {
  original: string;
  normalized: string;
  combined: string;
};

export function inferVisualPartHintsFromQuery(query: string, categoryHint?: string): VisualPartHints {
  const text = buildIntentText(query, categoryHint);
  const layout = extractLayout(text.combined);
  const pinCount = extractPinCount(text.combined) ?? layout?.pinCount;
  const rowCount = extractRowCount(text.combined) ?? layout?.rowCount;
  const pitchMm = extractPitchMm(text.combined);
  const family = extractConnectorFamily(text.combined);
  const mountingStyle = extractMountingStyle(text.combined);
  const gender = extractConnectorGender(text.combined);
  const colors = extractColors(text.combined);
  const cableWireCount = extractCableWireCount(text.combined);
  const motorHints = extractMotorHints(text.combined);

  const hints: VisualPartHints = {};
  if (pinCount) {
    hints.connectorPinCount = pinCount;
  }
  if (rowCount) {
    hints.connectorRowCount = rowCount;
  }
  if (pitchMm) {
    hints.connectorPitchMm = pitchMm;
  }
  if (family) {
    hints.connectorFamily = family;
  }
  if (mountingStyle) {
    hints.connectorMountingStyle = mountingStyle;
  }
  if (gender) {
    hints.connectorGender = gender;
  }
  if (colors.length > 0) {
    hints.color = colors;
  }
  if (cableWireCount) {
    hints.cableWireCount = cableWireCount;
  }
  if (motorHints) {
    hints.motorHints = motorHints;
  }
  return hints;
}

export function withInferredVisualHints(input: SearchPartsInput): SearchPartsInput {
  const inferred = inferVisualPartHintsFromQuery(input.query, input.categoryHint);
  return {
    ...input,
    visualHints: mergeVisualHints(inferred, input.visualHints)
  };
}

function mergeVisualHints(inferred: VisualPartHints, explicit: VisualPartHints | undefined): VisualPartHints | undefined {
  const motorHints = {
    ...inferred.motorHints,
    ...explicit?.motorHints
  };
  const merged = {
    ...inferred,
    ...explicit,
    color: explicit?.color ?? inferred.color,
    boardContext: explicit?.boardContext ?? inferred.boardContext,
    notes: explicit?.notes ?? inferred.notes,
    ...(Object.keys(motorHints).length > 0 ? { motorHints } : {})
  };

  return Object.keys(merged).length > 0 ? merged : explicit;
}

function buildIntentText(query: string, categoryHint: string | undefined): IntentText {
  const normalized = normalizeSearchQueryForSuppliers(query);
  const variants = normalizedQueryVariants(query);
  const normalizedText = [normalized.normalizedQuery, ...normalized.addedTerms, ...variants, categoryHint]
    .filter(Boolean)
    .join(" ");
  return {
    original: query,
    normalized: normalizedText,
    combined: `${query} ${normalizedText}`.toLowerCase()
  };
}

function extractLayout(text: string): { rowCount: number; pinCount: number } | undefined {
  for (const match of text.matchAll(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/gi)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 0 && second > 0 && first <= 4) {
      return {
        rowCount: first,
        pinCount: first * second
      };
    }
  }
  return undefined;
}

function extractPinCount(text: string): number | undefined {
  const patterns = [
    /\b(\d{1,3})\s*(?:pin|pins|position|positions|pos|circuit|circuits|contact|contacts|way|ways)\b/i,
    /\b(\d{1,3})(?:pos|p)\b/i
  ];
  for (const pattern of patterns) {
    const value = numberFromMatch(text.match(pattern));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractRowCount(text: string): number | undefined {
  if (/\b(single|1)\s*row\b/i.test(text)) {
    return 1;
  }
  if (/\b(dual|double|2)\s*row\b/i.test(text)) {
    return 2;
  }
  const value = numberFromMatch(text.match(/\b(\d{1,2})\s*row\b/i));
  return value && value <= 8 ? value : undefined;
}

function extractPitchMm(text: string): number | undefined {
  const mmPatterns = [
    /\b(\d+(?:\.\d+)?)\s*mm\s*(?:pitch|spacing)?\b/i,
    /\b(?:pitch|spacing)\s*(\d+(?:\.\d+)?)\s*mm\b/i
  ];
  for (const pattern of mmPatterns) {
    const value = decimalFromMatch(text.match(pattern));
    if (value) {
      return round(value, 3);
    }
  }

  const inchPatterns = [
    /\b(0?\.\d+|\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)\s*(?:pitch|spacing)?\b/i,
    /\b(?:pitch|spacing)\s*(0?\.\d+|\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)\b/i
  ];
  for (const pattern of inchPatterns) {
    const value = decimalFromMatch(text.match(pattern));
    if (value) {
      return round(value * 25.4, 3);
    }
  }
  return undefined;
}

function extractConnectorFamily(text: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bm12\b/i, "M12 circular connector"],
    [/\bm8\b/i, "M8 circular connector"],
    [/\bidc\b/i, "IDC"],
    [/\bbox\s*header\b/i, "box header"],
    [/\bpin\s*header\b/i, "pin header"],
    [/\bterminal\s*block\b|\bscrew\s*terminal\b/i, "terminal block"],
    [/\bjst\b/i, "JST"],
    [/\bmolex\b/i, "Molex"],
    [/\bdupont\b/i, "Dupont"],
    [/\bcircular\s*connector\b/i, "circular connector"]
  ];
  return firstLabel(text, patterns);
}

function extractMountingStyle(text: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bpanel\s*mount\b|\bbulkhead\b|\bflange\s*mount\b/i, "panel mount"],
    [/\bthrough\s*hole\b|\bthru\s*hole\b|\bth\b/i, "through hole"],
    [/\bsurface\s*mount\b|\bsmt\b|\bsmd\b/i, "surface mount"],
    [/\bboard\s*mount\b/i, "board mount"],
    [/\bcable\s*mount\b|\bfree\s*hanging\b/i, "cable mount"]
  ];
  return firstLabel(text, patterns);
}

function extractConnectorGender(text: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bfemale\b|\breceptacle\b|\bsocket\b/i, "female"],
    [/\bmale\b|\bplug\b/i, "male"],
    [/\bheader\b/i, "header"],
    [/\bhousing\b/i, "housing"]
  ];
  return firstLabel(text, patterns);
}

function extractColors(text: string): string[] {
  const colors = ["black", "white", "gray", "grey", "green", "red", "blue", "yellow"];
  return colors.filter((color) => new RegExp(`\\b${color}\\b`, "i").test(text)).map((color) => (color === "grey" ? "gray" : color));
}

function extractCableWireCount(text: string): number | undefined {
  return numberFromMatch(text.match(/\b(\d{1,3})\s*(?:wire|wires|conductor|conductors)\b/i));
}

function extractMotorHints(text: string): VisualPartHints["motorHints"] | undefined {
  const motorHints: NonNullable<VisualPartHints["motorHints"]> = {};
  if (/\bencoder\b/i.test(text)) {
    motorHints.hasEncoder = true;
  }
  if (/\bgear\s*motor\b|\bgearmotor\b|\bgearhead\b/i.test(text)) {
    motorHints.gearhead = true;
  }
  return Object.keys(motorHints).length > 0 ? motorHints : undefined;
}

function firstLabel(text: string, patterns: Array<[RegExp, string]>): string | undefined {
  return patterns.find(([pattern]) => pattern.test(text))?.[1];
}

function numberFromMatch(match: RegExpMatchArray | null): number | undefined {
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function decimalFromMatch(match: RegExpMatchArray | null): number | undefined {
  return numberFromMatch(match);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
