import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { DigiKeyClient } from "../src/suppliers/digikey/client.js";

const categories = [
  { name: "Embedded MCU", query: "STM32 CAN FD microcontroller" },
  { name: "Cable Assembly", query: "JST GH 6 pin cable assembly 300mm" },
  { name: "Motor", query: "24V BLDC motor encoder" },
  { name: "Connector", query: "M12 4 pin panel mount connector" },
  { name: "Sensor", query: "industrial pressure sensor 4-20mA" },
  { name: "Power Module", query: "isolated DC DC converter 24V 5V" }
];

const config = loadConfig();
const digikey = new DigiKeyClient(config.suppliers.digikey);

if (!config.suppliers.digikey.enabled) {
  console.error("DigiKey is not configured. Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET in .env.");
  process.exit(1);
}

for (const category of categories) {
  console.log(`\n## ${category.name}`);
  console.log(`Query: ${category.query}`);
  try {
    const result = await digikey.searchKeyword({
      query: category.query,
      limit: 3,
      inStockOnly: false
    });

    console.log(`Raw count: ${result.rawCount}`);
    if (result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.join(" | ")}`);
    }

    for (const candidate of result.candidates.slice(0, 3)) {
      console.log(
        [
          `- ${candidate.manufacturerPartNumber || "(no MPN)"}`,
          candidate.manufacturer ? `by ${candidate.manufacturer}` : undefined,
          candidate.supplierPartNumber ? `[${candidate.supplierPartNumber}]` : undefined,
          typeof candidate.availability.inStockQuantity === "number"
            ? `available=${candidate.availability.inStockQuantity}`
            : candidate.availability.stockText
              ? `availability=${candidate.availability.stockText}`
              : undefined,
          candidate.pricing[0]
            ? `price@${candidate.pricing[0].quantity}=${candidate.pricing[0].unitPrice} ${candidate.pricing[0].currency}`
            : undefined
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DigiKey error";
    console.log(`FAILED: ${message.replace(/\\s+/g, " ").slice(0, 500)}`);
  }
}
