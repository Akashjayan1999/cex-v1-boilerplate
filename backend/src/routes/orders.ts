import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { BALANCES, ORDERBOOK } from "../lib/store.js";
import { match } from "../engine/matcher.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import type { PlaceOrderBody } from "../types/index.js";

export const orderRouter = Router();

// All order routes require authentication
orderRouter.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
//  POST /orders  — place a new order
// ─────────────────────────────────────────────────────────────────────────────
orderRouter.post("/", async (req: AuthRequest, res: Response) => {
  const { stockId, side, type, qty, price } = req.body as PlaceOrderBody;
  const userId = req.userId!;

  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!stockId || !side || !type || !qty) {
    res.status(400).json({ error: "stockId, side, type, qty are required" });
    return;
  }
  if (type === "LIMIT" && price === undefined) {
    res.status(400).json({ error: "price is required for LIMIT orders" });
    return;
  }

  const stock = await prisma.stock.findUnique({ where: { id: stockId } });
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const userBal = BALANCES.get(userId);
  if (!userBal) {
    res.status(404).json({ error: "User balance not found" });
    return;
  }

  // ── Pre-trade balance check ───────────────────────────────────────────────
  if (side === "BUY" && type === "LIMIT") {
    const inr = userBal.INR as { total: number; locked: number };
    const cost = price! * qty;
    const available = inr.total - inr.locked;
    if (available < cost) {
      res.status(400).json({ error: "Insufficient INR balance" });
      return;
    }
  }

  if (side === "SELL" && type === "LIMIT") {
    const stockBal = userBal[stock.symbol] as
      | { total: number; locked: number }
      | undefined;
    const available = (stockBal?.total ?? 0) - (stockBal?.locked ?? 0);
    if (available < qty) {
      res.status(400).json({ error: "Insufficient stock balance" });
      return;
    }
  }

  if (side === "SELL" && type === "MARKET") {
    const stockBal = userBal[stock.symbol] as
      | { total: number; locked: number }
      | undefined;
    const available = (stockBal?.total ?? 0) - (stockBal?.locked ?? 0);
    if (available < qty) {
      res.status(400).json({ error: "Insufficient stock balance" });
      return;
    }
  }

  // ── Create order record ───────────────────────────────────────────────────
  const order = await prisma.order.create({
    data: {
      userId,
      stockId,
      side,
      type,
      qty,
      price: price !== undefined ? price : undefined,
      status: "OPEN",
    },
  });

  // ── Run matching engine ───────────────────────────────────────────────────
  const { fills, remainingQty } = match({
    incomingOrderId: order.id,
    userId,
    symbol: stock.symbol,
    stockId,
    side,
    type,
    qty,
    price,
  });

  // ── Persist fills + update order status in a transaction ─────────────────
  if (fills.length > 0) {
    const filledQtyTotal = fills.reduce((sum, f) => sum + f.qty, 0);
    const newStatus =
      filledQtyTotal >= qty ? "FILLED" : remainingQty > 0 ? "PARTIAL" : "OPEN";

    await prisma.$transaction(async (tx) => {
      // Upsert LastTrade for each fill (last one wins if multiple fills)
      for (const fill of fills) {
        await tx.fill.create({
          data: {
            stockId: fill.stockId,
            price: fill.price,
            qty: fill.qty,
            buyOrderId: fill.buyOrderId,
            sellOrderId: fill.sellOrderId,
          },
        });

        // Update the resting (counter) order's filledQty and status
        const counterOrderId =
          side === "BUY" ? fill.sellOrderId : fill.buyOrderId;

        const counterOrder = await tx.order.findUnique({
          where: { id: counterOrderId },
        });
        if (counterOrder) {
          const newFilled = counterOrder.filledQty + fill.qty;
          await tx.order.update({
            where: { id: counterOrderId },
            data: {
              filledQty: newFilled,
              status:
                newFilled >= counterOrder.qty
                  ? "FILLED"
                  : "PARTIAL",
            },
          });
        }

        // Upsert last trade price
        await tx.lastTrade.upsert({
          where: { stockId: fill.stockId },
          update: { price: fill.price, qty: fill.qty },
          create: { stockId: fill.stockId, price: fill.price, qty: fill.qty },
        });
      }

      // Update the incoming order
      await tx.order.update({
        where: { id: order.id },
        data: { filledQty: filledQtyTotal, status: newStatus },
      });
    });
  }

  res.status(201).json({
    orderId: order.id,
    status:
      fills.reduce((s, f) => s + f.qty, 0) >= qty
        ? "FILLED"
        : remainingQty > 0
          ? "PARTIAL"
          : "OPEN",
    fills: fills.map((f) => ({ price: f.price, qty: f.qty })),
    remainingQty,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /orders/:id  — cancel a resting order
// ─────────────────────────────────────────────────────────────────────────────
orderRouter.delete("/:id", async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { id } = req.params as { id: string };

  const order = await prisma.order.findUnique({
    where: { id  },
    include: { stock: true },
  });

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (order.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (order.status === "FILLED" || order.status === "CANCELLED") {
    res.status(400).json({ error: `Order is already ${order.status}` });
    return;
  }

  // Remove from in-memory book
  const book = ORDERBOOK.get(order.stock.symbol);
  if (book) {
    const side = order.side === "BUY" ? book.bids : book.asks;
    const price = Number(order.price ?? 0);
    const level = side.get(price);
    if (level) {
      const idx = level.orders.findIndex((o) => o.orderId === id);
      if (idx !== -1) {
        const remaining = level.orders[idx]!.qty - level.orders[idx]!.filledQty;
        level.totalQty -= remaining;
        level.orders.splice(idx, 1);
        if (level.orders.length === 0) side.delete(price);
      }
    }
  }

  // Unlock balances
  const remaining = order.qty - order.filledQty;
  const userBal = BALANCES.get(userId);
  if (userBal && remaining > 0) {
    if (order.side === "BUY" && order.type === "LIMIT") {
      const inr = userBal.INR as { total: number; locked: number };
      inr.locked -= Number(order.price) * remaining;
    } else if (order.side === "SELL") {
      const sym = order.stock.symbol;
      const s = userBal[sym] as { total: number; locked: number } | undefined;
      if (s) s.locked -= remaining;
    }
  }

  await prisma.order.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  res.json({ message: "Order cancelled" });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /orders  — list orders for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
orderRouter.get("/", async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { status, stockId } = req.query as {
    status?: string;
    stockId?: string;
  };

  const orders = await prisma.order.findMany({
    where: {
      userId,
      ...(status ? { status: status as any } : {}),
      ...(stockId ? { stockId } : {}),
    },
    include: { stock: { select: { symbol: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(orders);
});