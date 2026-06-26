export type QueryNormalization = {
  normalizedQuery: string;
  addedTerms: string[];
};

const phraseReplacements: Array<[RegExp, string]> = [
  [/패널\s*마운트|판넬\s*마운트/gi, "panel mount"],
  [/벌크\s*헤드|벌크헤드/gi, "bulkhead"],
  [/쓰루\s*홀|스루\s*홀|관통\s*홀/gi, "through hole"],
  [/표면\s*실장|표면실장/gi, "surface mount"],
  [/기판\s*대\s*전선|전선\s*대\s*기판/gi, "wire to board"],
  [/전선\s*대\s*전선/gi, "wire to wire"],
  [/나사\s*단자|스크류\s*터미널|터미널\s*블록/gi, "screw terminal block"],
  [/박스\s*헤더/gi, "box header"],
  [/핀\s*헤더/gi, "pin header"],
  [/방수\s*커넥터/gi, "waterproof connector"],
  [/암\s*커넥터|암컷\s*커넥터/gi, "female connector"],
  [/수\s*커넥터|수컷\s*커넥터/gi, "male connector"],
  [/항공\s*커넥터|원형\s*커넥터/gi, "circular connector"],
  [/리본\s*케이블/gi, "ribbon cable"],
  [/플랫\s*케이블/gi, "flat cable"],
  [/점퍼\s*선|점퍼\s*와이어/gi, "jumper wire"],
  [/기어\s*모터/gi, "gear motor"],
  [/스텝\s*모터|스테퍼\s*모터/gi, "stepper motor"],
  [/서보\s*모터/gi, "servo motor"],
  [/브러시리스\s*모터|BLDC\s*모터/gi, "brushless DC motor"],
  [/엔코더\s*모터/gi, "encoder motor"],
  [/근접\s*센서/gi, "proximity sensor"],
  [/압력\s*센서/gi, "pressure sensor"],
  [/온도\s*센서/gi, "temperature sensor"],
  [/전원\s*모듈/gi, "power module"],
  [/전원\s*공급|파워\s*서플라이/gi, "power supply"],
  [/개발\s*보드/gi, "development board"],
  [/릴레이\s*모듈/gi, "relay module"]
];

const tokenReplacements: Array<[RegExp, string]> = [
  [/커넥터/gi, "connector"],
  [/하우징/gi, "housing"],
  [/단자/gi, "terminal"],
  [/케이블/gi, "cable"],
  [/전선/gi, "wire"],
  [/모터/gi, "motor"],
  [/센서/gi, "sensor"],
  [/스위치/gi, "switch"],
  [/릴레이/gi, "relay"],
  [/엔코더/gi, "encoder"],
  [/어댑터/gi, "adapter"],
  [/소켓/gi, "socket"],
  [/헤더/gi, "header"],
  [/플러그/gi, "plug"],
  [/잭/gi, "jack"],
  [/보드/gi, "board"],
  [/기판/gi, "PCB"],
  [/납땜/gi, "solder"],
  [/압착/gi, "crimp"],
  [/잠금|락킹/gi, "locking"],
  [/방수/gi, "waterproof"],
  [/방진/gi, "dustproof"],
  [/차폐|쉴드/gi, "shielded"],
  [/회색|그레이/gi, "gray"],
  [/검정|검은색|블랙/gi, "black"],
  [/흰색|화이트/gi, "white"],
  [/녹색|그린/gi, "green"],
  [/빨강|빨간색|레드/gi, "red"],
  [/파랑|파란색|블루/gi, "blue"],
  [/노랑|노란색|옐로우/gi, "yellow"]
];

const addedTermRules: Array<[RegExp, string[]]> = [
  [/\bM12\b/i, ["M12 circular connector"]],
  [/\bM8\b/i, ["M8 circular connector"]],
  [/\bIDC\b/i, ["IDC ribbon cable connector"]],
  [/\bJTAG\b|\bSWD\b/i, ["debug connector"]],
  [/\bRS[-\s]?485\b/i, ["industrial interface transceiver"]],
  [/\bCAN\b/i, ["CAN bus"]],
  [/\bencoder\b/i, ["incremental encoder"]],
  [/\bgear motor\b/i, ["gearmotor"]],
  [/\bpanel mount\b/i, ["bulkhead mount"]],
  [/\b2\.54\s*mm\b|\b0\.100\b/i, ["0.100 inch pitch"]],
  [/\b1\.27\s*mm\b|\b0\.050\b/i, ["0.050 inch pitch"]],
  [/\b2\.00\s*mm\b/i, ["2.00mm pitch"]],
  [/\b2\.50\s*mm\b/i, ["2.50mm pitch"]],
  [/\b5\.08\s*mm\b|\b0\.200\b/i, ["5.08mm pitch"]]
];

export function normalizeSearchQueryForSuppliers(query: string): QueryNormalization {
  let normalized = query;
  for (const [pattern, replacement] of phraseReplacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalizeKoreanCounts(normalized);
  for (const [pattern, replacement] of tokenReplacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalizeSpacing(normalized);

  const addedTerms = new Set<string>();
  for (const [pattern, terms] of addedTermRules) {
    if (pattern.test(normalized)) {
      for (const term of terms) {
        if (!normalized.toLowerCase().includes(term.toLowerCase())) {
          addedTerms.add(term);
        }
      }
    }
  }

  return {
    normalizedQuery: normalized,
    addedTerms: Array.from(addedTerms)
  };
}

export function normalizedQueryVariants(query: string): string[] {
  const normalized = normalizeSearchQueryForSuppliers(query);
  const variants = new Set<string>();
  if (normalized.normalizedQuery && normalized.normalizedQuery !== normalizeSpacing(query)) {
    variants.add(normalized.normalizedQuery);
  }
  if (normalized.addedTerms.length > 0) {
    variants.add(normalizeSpacing([normalized.normalizedQuery, ...normalized.addedTerms.slice(0, 3)].join(" ")));
  }
  return Array.from(variants);
}

function normalizeKoreanCounts(value: string): string {
  return value
    .replace(/(\d+)\s*핀/gi, "$1 pin")
    .replace(/(\d+)\s*포지션/gi, "$1 position")
    .replace(/(\d+)\s*극/gi, "$1 position")
    .replace(/(\d+)\s*회로/gi, "$1 circuit")
    .replace(/(\d+)\s*열/gi, "$1 row")
    .replace(/(\d+)\s*가닥/gi, "$1 wire")
    .replace(/(\d+)\s*선/gi, "$1 wire")
    .replace(/(\d+(?:\.\d+)?)\s*미리/gi, "$1mm")
    .replace(/(\d+(?:\.\d+)?)\s*밀리/gi, "$1mm");
}

function normalizeSpacing(value: string): string {
  return value.replace(/[，、]/g, " ").replace(/\s+/g, " ").trim();
}
