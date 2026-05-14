import "dotenv/config";
import { app } from "./src/app.js";
import { bootstrapOrderBook, bootstrapBalances } from "./src/lib/boostrap.js";
import { prisma } from "./src/lib/prisma.js";
 
const PORT = Number(process.env.PORT ?? 3000);
 
async function main(): Promise<void> {
  // Verify DB connection
  await prisma.$connect();
  console.log("[db] Connected to PostgreSQL");
 
  // Rebuild in-memory state from persistent DB
  await bootstrapBalances();
  await bootstrapOrderBook();
 
  app.listen(PORT, () => {
    console.log(`[server] CEX backend running on http://localhost:${PORT}`);
  });
}
 
main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
 
// Graceful shutdown
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
 