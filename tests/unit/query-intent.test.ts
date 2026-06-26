import { describe, expect, it } from "vitest";
import { inferVisualPartHintsFromQuery } from "../../src/search/query-intent.js";

describe("query intent inference", () => {
  it("extracts connector hints from normalized Korean field language", () => {
    const hints = inferVisualPartHintsFromQuery("2핀 회색 커넥터 하우징 2.54미리");

    expect(hints.connectorPinCount).toBe(2);
    expect(hints.connectorPitchMm).toBe(2.54);
    expect(hints.connectorGender).toBe("housing");
    expect(hints.color).toContain("gray");
  });

  it("extracts compact connector layout and family hints", () => {
    const hints = inferVisualPartHintsFromQuery("2x10 IDC box header 0.100 inch through hole");

    expect(hints.connectorRowCount).toBe(2);
    expect(hints.connectorPinCount).toBe(20);
    expect(hints.connectorPitchMm).toBe(2.54);
    expect(hints.connectorFamily).toBe("IDC");
    expect(hints.connectorMountingStyle).toBe("through hole");
  });

  it("extracts motor intent from rough text", () => {
    const hints = inferVisualPartHintsFromQuery("엔코더 달린 DC 기어모터");

    expect(hints.motorHints?.hasEncoder).toBe(true);
    expect(hints.motorHints?.gearhead).toBe(true);
  });
});
