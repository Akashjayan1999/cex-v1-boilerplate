import type { Balances, OrderBook } from "../types/index.js";
 
// ─────────────────────────────────────────────────────────────────────────────
//  Global in-memory state
//  A real exchange would use Redis or a custom C++ order-book process.
//  For this architecture we keep it in-process and rebuild on startup.
// ─────────────────────────────────────────────────────────────────────────────
 
export const ORDERBOOK: OrderBook = new Map();
export const BALANCES: Balances = new Map();