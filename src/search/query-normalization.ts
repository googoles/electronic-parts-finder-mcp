export type QueryNormalization = {
  normalizedQuery: string;
  addedTerms: string[];
};

const phraseReplacements: Array<[RegExp, string]> = [
  [/패널\s*마운트|판넬\s*마운트|패널형|판넬형/gi, "panel mount"],
  [/벌크\s*헤드|벌크헤드/gi, "bulkhead"],
  [/쓰루\s*홀|스루\s*홀|관통\s*홀|삽입\s*실장/gi, "through hole"],
  [/표면\s*실장|표면실장|SMD|SMT/gi, "surface mount"],
  [/기판\s*대\s*전선|전선\s*대\s*기판|와이어\s*투\s*보드|전선\s*기판/gi, "wire to board"],
  [/기판\s*대\s*기판|보드\s*투\s*보드/gi, "board to board"],
  [/전선\s*대\s*전선|와이어\s*투\s*와이어/gi, "wire to wire"],
  [/나사\s*단자|스크류\s*터미널|터미널\s*블록|단자대|단자\s*블록/gi, "screw terminal block"],
  [/스프링\s*클램프|푸시\s*인\s*단자|푸쉬\s*인\s*단자|푸시인|푸쉬인/gi, "spring clamp terminal block"],
  [/압착\s*단자|크림프\s*단자/gi, "crimp terminal"],
  [/링\s*단자|링\s*터미널/gi, "ring terminal"],
  [/페룰\s*단자|페럴\s*단자/gi, "ferrule terminal"],
  [/박스\s*헤더/gi, "box header"],
  [/핀\s*헤더/gi, "pin header"],
  [/방수\s*커넥터/gi, "waterproof connector"],
  [/암\s*커넥터|암컷\s*커넥터|암형\s*커넥터|소켓형\s*커넥터/gi, "female connector"],
  [/수\s*커넥터|수컷\s*커넥터|수형\s*커넥터|플러그형\s*커넥터/gi, "male connector"],
  [/항공\s*커넥터|항공\s*잭|원형\s*커넥터|써큘러\s*커넥터/gi, "circular connector"],
  [/케이블\s*글랜드|방수\s*글랜드/gi, "cable gland"],
  [/리본\s*케이블/gi, "ribbon cable"],
  [/플랫\s*케이블/gi, "flat cable"],
  [/점퍼\s*선|점퍼\s*와이어/gi, "jumper wire"],
  [/기어\s*모터|감속\s*모터/gi, "gear motor"],
  [/스텝\s*모터|스테퍼\s*모터/gi, "stepper motor"],
  [/서보\s*모터/gi, "servo motor"],
  [/브러시리스\s*모터|브러쉬리스\s*모터|BLDC\s*모터/gi, "brushless DC motor"],
  [/엔코더\s*모터/gi, "encoder motor"],
  [/근접\s*센서/gi, "proximity sensor"],
  [/광전\s*센서|포토\s*센서/gi, "photoelectric sensor"],
  [/압력\s*센서/gi, "pressure sensor"],
  [/온도\s*센서/gi, "temperature sensor"],
  [/리미트\s*스위치/gi, "limit switch"],
  [/솔레노이드\s*밸브/gi, "solenoid valve"],
  [/전원\s*모듈/gi, "power module"],
  [/전원\s*공급|파워\s*서플라이|SMPS/gi, "power supply"],
  [/전압\s*레귤레이터|전압\s*조정기/gi, "voltage regulator"],
  [/DC\s*DC|DC-DC|디씨\s*디씨/gi, "DC DC converter"],
  [/리니어\s*레귤레이터|LDO/gi, "LDO regulator"],
  [/저항\s*어레이|저항\s*네트워크/gi, "resistor array"],
  [/칩\s*저항|SMD\s*저항/gi, "chip resistor"],
  [/칩\s*커패시터|칩\s*콘덴서|SMD\s*커패시터|SMD\s*콘덴서/gi, "MLCC capacitor"],
  [/전해\s*커패시터|전해\s*콘덴서/gi, "aluminum electrolytic capacitor"],
  [/세라믹\s*커패시터|세라믹\s*콘덴서/gi, "ceramic capacitor"],
  [/쇼트키\s*다이오드/gi, "Schottky diode"],
  [/제너\s*다이오드|정전압\s*다이오드/gi, "Zener diode"],
  [/브리지\s*다이오드/gi, "bridge rectifier"],
  [/로직\s*레벨\s*MOSFET/gi, "logic level MOSFET"],
  [/포토\s*커플러|옵토\s*커플러/gi, "optocoupler"],
  [/크리스탈\s*오실레이터|수정\s*발진기/gi, "crystal oscillator"],
  [/개발\s*보드/gi, "development board"],
  [/릴레이\s*모듈/gi, "relay module"],
  [/PLC\s*입출력|PLC\s*I\/O|I\/O\s*모듈|입출력\s*모듈/gi, "PLC I/O module"],
  [/디지털\s*입력|DI\s*모듈/gi, "digital input module"],
  [/디지털\s*출력|DO\s*모듈/gi, "digital output module"],
  [/아날로그\s*입력|AI\s*모듈/gi, "analog input module"],
  [/아날로그\s*출력|AO\s*모듈/gi, "analog output module"],
  [/서보\s*드라이브/gi, "servo drive"],
  [/인버터|VFD/gi, "variable frequency drive"]
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
  [/저항/gi, "resistor"],
  [/커패시터|콘덴서/gi, "capacitor"],
  [/인덕터|코일/gi, "inductor"],
  [/다이오드/gi, "diode"],
  [/트랜지스터/gi, "transistor"],
  [/레귤레이터/gi, "regulator"],
  [/정류기/gi, "rectifier"],
  [/퓨즈/gi, "fuse"],
  [/배리스터/gi, "varistor"],
  [/써미스터|서미스터/gi, "thermistor"],
  [/비드/gi, "ferrite bead"],
  [/어댑터/gi, "adapter"],
  [/소켓/gi, "socket"],
  [/헤더/gi, "header"],
  [/플러그/gi, "plug"],
  [/잭/gi, "jack"],
  [/암형|암컷|소켓형/gi, "female"],
  [/수형|수컷|플러그형/gi, "male"],
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
  [/\bM5\b/i, ["M5 circular connector"]],
  [/\bM23\b/i, ["M23 circular connector"]],
  [/\bIDC\b/i, ["IDC ribbon cable connector"]],
  [/\bJTAG\b|\bSWD\b/i, ["debug connector"]],
  [/\bRS[-\s]?485\b/i, ["industrial interface transceiver"]],
  [/\bCAN\b/i, ["CAN bus"]],
  [/\bencoder\b/i, ["incremental encoder"]],
  [/\bgear motor\b/i, ["gearmotor"]],
  [/\bpanel mount\b/i, ["bulkhead mount"]],
  [/\bterminal block\b/i, ["industrial terminal block"]],
  [/\bPLC I\/O module\b|\bdigital input module\b|\bdigital output module\b|\banalog input module\b|\banalog output module\b/i, ["industrial automation module"]],
  [/\bvariable frequency drive\b/i, ["VFD inverter"]],
  [/\bMLCC\b|\bceramic capacitor\b/i, ["multilayer ceramic capacitor"]],
  [/\baluminum electrolytic capacitor\b/i, ["electrolytic capacitor"]],
  [/\bSchottky diode\b/i, ["switching diode"]],
  [/\bZener diode\b/i, ["voltage reference diode"]],
  [/\bLDO regulator\b/i, ["linear regulator"]],
  [/\bDC DC converter\b/i, ["switching regulator"]],
  [/\b0603\b/i, ["1608 metric"]],
  [/\b0402\b/i, ["1005 metric"]],
  [/\b0805\b/i, ["2012 metric"]],
  [/\b1206\b/i, ["3216 metric"]],
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
    .replace(/(\d+(?:\.\d+)?)\s*밀리/gi, "$1mm")
    .replace(/(\d+(?:\.\d+)?)\s*옴/gi, "$1 ohm")
    .replace(/(\d+(?:\.\d+)?)\s*키로\s*옴/gi, "$1 kOhm")
    .replace(/(\d+(?:\.\d+)?)\s*킬로\s*옴/gi, "$1 kOhm")
    .replace(/(\d+(?:\.\d+)?)\s*메가\s*옴/gi, "$1 MOhm")
    .replace(/(\d+(?:\.\d+)?)\s*마이크로\s*패럿/gi, "$1uF")
    .replace(/(\d+(?:\.\d+)?)\s*나노\s*패럿/gi, "$1nF")
    .replace(/(\d+(?:\.\d+)?)\s*피코\s*패럿/gi, "$1pF")
    .replace(/(\d+)\s*\/\s*(\d+)\s*와트/gi, "$1/$2W")
    .replace(/(\d+(?:\.\d+)?)\s*와트/gi, "$1W");
}

function normalizeSpacing(value: string): string {
  return value.replace(/[，、]/g, " ").replace(/\s+/g, " ").trim();
}
