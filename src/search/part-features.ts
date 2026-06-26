import type { PartCandidate } from "../normalize/normalized-part.js";

export type PartFeatures = {
  pinCounts: number[];
  rowCounts: number[];
  pitchMm: number[];
  mountingStyles: string[];
  genders: string[];
  connectorFamilies: string[];
};

const connectorFamilyPatterns: Array<[RegExp, string]> = [
  [/\bidc\b/i, "IDC"],
  [/\b(jtag|arm\s*20)\b/i, "ARM JTAG"],
  [/\bm12\b/i, "M12"],
  [/\bm8\b/i, "M8"],
  [/\bjst\b/i, "JST"],
  [/\bmolex\b/i, "Molex"],
  [/\bdupont\b/i, "Dupont"],
  [/\bterminal\s*block\b/i, "terminal block"],
  [/\bbox\s*header\b/i, "box header"],
  [/\bpin\s*header\b/i, "pin header"]
];

const mountingPatterns: Array<[RegExp, string]> = [
  [/\b(panel|bulkhead|flange)\s*mount\b/i, "panel mount"],
  [/\bthrough\s*hole\b|\bthru\s*hole\b|\bth\b/i, "through hole"],
  [/\bsurface\s*mount\b|\bsmt\b|\bsmd\b/i, "surface mount"],
  [/\bboard\s*mount\b/i, "board mount"],
  [/\bwire\s*to\s*board\b/i, "wire-to-board"],
  [/\bcable\s*mount\b|\bfree\s*hanging\b/i, "cable mount"]
];

const genderPatterns: Array<[RegExp, string]> = [
  [/\breceptacle\b|\bsocket\b|\bfemale\b/i, "female"],
  [/\bplug\b|\bmale\b/i, "male"],
  [/\bheader\b/i, "header"],
  [/\bhousing\b/i, "housing"]
];

export function extractPartFeatures(candidate: PartCandidate): PartFeatures {
  const text = featureText(candidate);
  return {
    pinCounts: uniqueNumbers([...extractPinCounts(text), ...extractPinCountsFromSpecs(candidate)]),
    rowCounts: uniqueNumbers(extractRowCounts(text)),
    pitchMm: uniqueNumbers(extractPitchMm(text).map((value) => round(value, 3))),
    mountingStyles: uniqueStrings(matchPatterns(text, mountingPatterns)),
    genders: uniqueStrings(matchPatterns(text, genderPatterns)),
    connectorFamilies: uniqueStrings(matchPatterns(text, connectorFamilyPatterns))
  };
}

export function pitchMatches(a: number, b: number, tolerance = 0.08): boolean {
  return Math.abs(a - b) <= tolerance;
}

function featureText(candidate: PartCandidate): string {
  return [
    candidate.manufacturer,
    candidate.manufacturerPartNumber,
    candidate.supplierPartNumber,
    candidate.description,
    candidate.categoryPath?.join(" "),
    candidate.packaging,
    candidate.lifecycleStatus,
    Object.entries(candidate.specs)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function extractPinCounts(text: string): number[] {
  const values: number[] = [];
  const patterns = [
    /\b(\d{1,3})\s*(?:position|pos|circuit|circuits|ckt|pin|pins|contact|contacts|way|ways)\b/gi,
    /\b(\d{1,2})\s*x\s*(\d{1,2})\b/gi,
    /\b(?:single|dual|double)\s*row\s+(\d{1,3})\s*(?:position|pos|pin|contact)s?\b/gi
  ];

  for (const match of text.matchAll(patterns[0])) {
    values.push(Number(match[1]));
  }
  for (const match of text.matchAll(patterns[1])) {
    values.push(Number(match[1]) * Number(match[2]));
  }
  for (const match of text.matchAll(patterns[2])) {
    values.push(Number(match[1]));
  }
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

function extractPinCountsFromSpecs(candidate: PartCandidate): number[] {
  const values: number[] = [];
  for (const [key, value] of Object.entries(candidate.specs)) {
    if (!/position|pin|contact|circuit/i.test(key)) {
      continue;
    }
    const number = typeof value === "number" ? value : Number(String(value).match(/\d+/)?.[0]);
    if (Number.isFinite(number) && number > 0) {
      values.push(number);
    }
  }
  return values;
}

function extractRowCounts(text: string): number[] {
  const values: number[] = [];
  if (/\bsingle\s*row\b/i.test(text)) {
    values.push(1);
  }
  if (/\bdual\s*row\b|\bdouble\s*row\b/i.test(text)) {
    values.push(2);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/gi)) {
    values.push(Number(match[1]));
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*row\b/gi)) {
    values.push(Number(match[1]));
  }
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

function extractPitchMm(text: string): number[] {
  const values: number[] = [];
  const mmPatterns = [
    /\b(?:pitch|spacing)[^\d]{0,16}(\d+(?:\.\d+)?)\s*mm\b/gi,
    /\b(\d+(?:\.\d+)?)\s*mm\s*(?:pitch|spacing|contact\s*spacing)\b/gi
  ];
  for (const pattern of mmPatterns) {
    for (const match of text.matchAll(pattern)) {
      values.push(Number(match[1]));
    }
  }

  const inchPatterns = [
    /\b(?:pitch|spacing)[^\d]{0,16}(0?\.\d+|\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)(?=\W|$)/gi,
    /\b(0?\.\d+|\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)\s*(?:pitch|spacing)\b/gi
  ];
  for (const pattern of inchPatterns) {
    for (const match of text.matchAll(pattern)) {
      values.push(Number(match[1]) * 25.4);
    }
  }

  if (/\b(?:connector|header|socket|receptacle|housing|terminal|idc)\b/i.test(text)) {
    for (const match of text.matchAll(/\b2\.54\s*mm\b/gi)) {
      values.push(Number(match[0].replace(/mm/i, "")));
    }
    for (const match of text.matchAll(/\b0?\.100\s*(?:"|in|inch|inches)(?=\W|$)/gi)) {
      values.push(Number(match[0].replace(/["a-z]/gi, "")) * 25.4);
    }
  }

  return values.filter((value) => Number.isFinite(value) && value > 0 && value <= 50);
}

function matchPatterns(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => round(value, 3))));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
