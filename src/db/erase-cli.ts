import { pathToFileURL } from "node:url";
import { loadEnv } from "../config/env.js";
import { createPool } from "./client.js";
import { eraseByEmail } from "./erasure.js";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("usage: pnpm erase <email>");
  process.exit(2);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const pool = createPool(loadEnv().DATABASE_URL);
  eraseByEmail(pool, email)
    .then((counts) => {
      // Counts only: never print the address back into shell history/logs beyond the argv.
      console.log("erased locally:", counts);
      console.log("Reminder: also delete the contact in your CRM (HubSpot: GDPR delete).");
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
