import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { MouserClient } from "../src/suppliers/mouser/client.js";

const categories = [
  { name: "Embedded MCU", query: "STM32 CAN FD microcontroller" },
  { name: "Cable Assembly", query: "JST GH 6 pin cable assembly 300mm" },
  { name: "Motor", query: "24V BLDC motor encoder" },
  { name: "Connector", query: "M12 4 pin panel mount connector" },
  { name: "Sensor", query: "industrial pressure sensor 4-20mA" },
  { name: "Power Module", query: "isolated DC DC converter 24V 5V" }
];

const config = loadConfig();
const mouser = new MouserClient(config.suppliers.mouser);

if (!config.suppliers.mouser.enabled) {
  console.error("Mouser is not configured. Set MOUSER_SEARCH_API_KEY in .env.");
  process.exit(1);
}

for (const category of categories) {
  const result = await mouser.searchKeyword({
    query: category.query,
    limit: 3,
    inStockOnly: true
  });

  console.log(`\n## ${category.name}`);
  console.log(`Query: ${category.query}`);
  console.log(`Raw count: ${result.rawCount}`);

  for (const candidate of result.candidates.slice(0, 3)) {
    console.log(
      [
        `- ${candidate.manufacturerPartNumber || "(no MPN)"}`,
        candidate.manufacturer ? `by ${candidate.manufacturer}` : undefined,
        candidate.supplierPartNumber ? `[${candidate.supplierPartNumber}]` : undefined,
        candidate.availability.stockText ? `availability=${candidate.availability.stockText}` : undefined,
        candidate.pricing[0]
          ? `price@${candidate.pricing[0].quantity}=${candidate.pricing[0].unitPrice} ${candidate.pricing[0].currency}`
          : undefined
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}
