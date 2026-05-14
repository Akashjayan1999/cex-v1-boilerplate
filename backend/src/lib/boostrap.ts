import { prisma } from "./prisma.js";
import { ORDERBOOK, BALANCES } from "./store.js";
import type { SymbolBook, PriceLevel, UserBalances } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Rebuild in-memory order book from all OPEN / PARTIAL orders in the DB.
//  Called once at server startup.
// ─────────────────────────────────────────────────────────────────────────────
export async function bootstrapOrderBook(): Promise<void> {
  const openOrders = await prisma.order.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] } },
    include: { stock: true },
    orderBy: { createdAt: "asc" },
  });

  for (const order of openOrders) {
    const symbol = order.stock.symbol;

    if (!ORDERBOOK.has(symbol)) {
      ORDERBOOK.set(symbol, { bids: new Map(), asks: new Map() });
    }

    const book = ORDERBOOK.get(symbol)!;
    const side = order.side === "BUY" ? book.bids : book.asks;
    const price = Number(order.price ?? 0);
    const remaining = order.qty - order.filledQty;

    if (!side.has(price)) {
      side.set(price, { totalQty: 0, orders: [] });
    }

    const level = side.get(price)!;
    level.totalQty += remaining;
    level.orders.push({
      orderId: order.id,
      userId: order.userId,
      qty: order.qty,
      filledQty: order.filledQty,
      createdAt: order.createdAt,
    });
  }

  console.log(`[bootstrap] Order book loaded — ${openOrders.length} resting orders`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ensure every stock symbol has a book entry (called when a new stock is added)
// ─────────────────────────────────────────────────────────────────────────────
export function ensureBook(symbol: string): SymbolBook {
  if (!ORDERBOOK.has(symbol)) {
    ORDERBOOK.set(symbol, { bids: new Map(), asks: new Map() });
  }
  return ORDERBOOK.get(symbol)!;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap balances from all users
//  We keep a simple INR + per-symbol stock balance per user.
//  In production this would be a separate micro-service / Redis hash.
// ─────────────────────────────────────────────────────────────────────────────
export async function bootstrapBalances(): Promise<void> {
  const users = await prisma.user.findMany();

  for (const user of users) {
    if (!BALANCES.has(user.id)) {
      const emptyBalance: UserBalances = {
        INR: { total: 0, locked: 0 },
      };
      BALANCES.set(user.id, emptyBalance);
    }
  }

  // Recompute locked INR from open BUY LIMIT orders
  const openBuys = await prisma.order.findMany({
    where: { side: "BUY", type: "LIMIT", status: { in: ["OPEN", "PARTIAL"] } },
  });

  for (const order of openBuys) {
    const bal = BALANCES.get(order.userId);
    if (!bal) continue;
    const inr = bal.INR as { total: number; locked: number };
    inr.locked += (order.qty - order.filledQty) * Number(order.price);
  }

  // Recompute locked stock from open SELL LIMIT orders
  const openSells = await prisma.order.findMany({
    where: { side: "SELL", type: "LIMIT", status: { in: ["OPEN", "PARTIAL"] } },
    include: { stock: true },
  });

  for (const order of openSells) {
    const bal = BALANCES.get(order.userId);
    if (!bal) continue;
    const symbol = order.stock.symbol;

    if (!bal[symbol]) {
      bal[symbol] = { total: 0, locked: 0 };
    }

    (bal[symbol] as { total: number; locked: number }).locked +=
      order.qty - order.filledQty;
  }

  console.log(`[bootstrap] Balances loaded — ${users.length} users`);
}