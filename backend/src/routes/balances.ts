import { Router, type Response } from "express";
import { BALANCES } from "../lib/store.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import type { OnRampBody } from "../types/index.js";

export const balanceRouter = Router();

balanceRouter.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
//  GET /balances  — return the authenticated user's full balance
// ─────────────────────────────────────────────────────────────────────────────
balanceRouter.get("/", (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const bal = BALANCES.get(userId);

  if (!bal) {
    res.status(404).json({ error: "Balance not found" });
    return;
  }

  // Serialise: convert Map entries to a plain object
  res.json(bal);
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /balances/onramp  — add INR to user account (simulates a deposit)
// ─────────────────────────────────────────────────────────────────────────────
balanceRouter.post("/onramp", (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { amount } = req.body as OnRampBody;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  let bal = BALANCES.get(userId);
  if (!bal) {
    bal = { INR: { total: 0, locked: 0 } };
    BALANCES.set(userId, bal);
  }

  const inr = bal.INR as { total: number; locked: number };
  inr.total += amount;

  res.json({ INR: inr });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /balances/onramp-stock  — credit stock to user account (for testing)
// ─────────────────────────────────────────────────────────────────────────────
balanceRouter.post("/onramp-stock", (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { symbol, qty } = req.body as { symbol: string; qty: number };

  if (!symbol || !qty || qty <= 0) {
    res.status(400).json({ error: "symbol and qty (positive) are required" });
    return;
  }

  const bal = BALANCES.get(userId);
  if (!bal) {
    res.status(404).json({ error: "Balance not found" });
    return;
  }

  const sym = symbol.toUpperCase();
  if (!bal[sym]) bal[sym] = { total: 0, locked: 0 };
  (bal[sym] as { total: number; locked: number }).total += qty;

  res.json({ symbol: sym, balance: bal[sym] });
});