import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

describe("loadConfig", () => {
  it("keeps suppliers disabled when credential keys are blank", () => {
    const config = loadConfig();

    expect(config.suppliers.mouser.enabled).toBe(false);
    expect(config.suppliers.digikey.enabled).toBe(false);
    expect(config.suppliers.aliexpress.enabled).toBe(false);
    expect(config.suppliers.mouser.missing).toContain("MOUSER_SEARCH_API_KEY");
    expect(config.suppliers.digikey.missing).toContain("DIGIKEY_CLIENT_ID");
    expect(config.suppliers.aliexpress.missing).toContain("ALIEXPRESS_APP_KEY");
  });
});
