import { describe, expect, it } from "vitest";
import { signAliExpressRequest } from "../../src/suppliers/aliexpress/client.js";

describe("AliExpress Open Platform client", () => {
  it("generates stable uppercase HMAC-SHA256 signatures independent of parameter order", () => {
    const first = signAliExpressRequest(
      "/aliexpress/ds/textsearch",
      {
        app_key: "app-key",
        sign_method: "sha256",
        timestamp: "2026-06-26T00:00:00+0000",
        keywords: "M12 connector",
        access_token: "token"
      },
      "secret"
    );
    const second = signAliExpressRequest(
      "/aliexpress/ds/textsearch",
      {
        keywords: "M12 connector",
        timestamp: "2026-06-26T00:00:00+0000",
        access_token: "token",
        app_key: "app-key",
        sign_method: "sha256"
      },
      "secret"
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-F0-9]{64}$/);
  });
});
