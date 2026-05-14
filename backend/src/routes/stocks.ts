import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { ORDERBOOK } from "../lib/store.js";
import { ensureBook } from "../lib/boostrap.js";
import { authenticate } from "../middleware/auth.js";

export const stockRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
//  GET /stocks  — list all stocks
// ─────────────────────────────────────────────────────────────────────────────
stockRouter.get("/", async (_req: Request, res: Response) => {
  const stocks = await prisma.stock.findMany({
    include: { lastTrade: true },
    orderBy: { symbol: "asc" },
  });
  res.json(stocks);
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /stocks  — create a new stock (admin only in production)
// ─────────────────────────────────────────────────────────────────────────────
stockRouter.post("/", authenticate, async (req: Request, res: Response) => {
  const { title, symbol } = req.body as { title: string; symbol: string };

  if (!title || !symbol) {
    res.status(400).json({ error: "title and symbol are required" });
    return;
  }

  const stock = await prisma.stock.create({
    data: { title, symbol: symbol.toUpperCase() },
  });

  // Initialise empty book for this symbol
  ensureBook(stock.symbol);

  res.status(201).json(stock);
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /stocks/:symbol/depth  — current order book depth (bids + asks)
//  This reads from the in-memory book — no DB hit required.
// ─────────────────────────────────────────────────────────────────────────────
stockRouter.get("/:symbol/depth", (req: Request, res: Response) => {
  const symbol = (req.params.symbol! as string).toUpperCase();
  const book = ORDERBOOK.get(symbol);

  if (!book) {
    res.json({ bids: [], asks: [] });
    return;
  }

  // Bids: descending price
  const bids = [...book.bids.entries()]
    .sort(([a], [b]) => b - a)
    .map(([price, level]) => ({ price, totalQty: level.totalQty }));

  // Asks: ascending price
  const asks = [...book.asks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([price, level]) => ({ price, totalQty: level.totalQty }));

  res.json({ bids, asks });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /stocks/:symbol/last-trade  — last traded price for a symbol
// ─────────────────────────────────────────────────────────────────────────────
stockRouter.get("/:symbol/last-trade", async (req: Request, res: Response) => {
  const symbol = (req.params.symbol! as string).toUpperCase();

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: { lastTrade: true },
  });

  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  if (!stock.lastTrade) {
    res.json({ price: null, qty: null, updatedAt: null });
    return;
  }

  res.json(stock.lastTrade);
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /stocks/:symbol/fills  — recent trade history (from DB)
// ─────────────────────────────────────────────────────────────────────────────
stockRouter.get("/:symbol/fills", async (req: Request, res: Response) => {
  const symbol = (req.params.symbol! as string).toUpperCase();
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const fills = await prisma.fill.findMany({
    where: { stockId: stock.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { price: true, qty: true, createdAt: true },
  });

  res.json(fills);
});