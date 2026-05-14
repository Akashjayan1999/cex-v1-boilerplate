import { ORDERBOOK, BALANCES } from "../lib/store.js";
import { ensureBook } from "../lib/boostrap.js";
import type {
  MatchResult,
  MatchedFill,
  BookOrder,
  PriceLevel,
  Side,
  OrderType,
} from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sortedBidPrices(map: Map<number, PriceLevel>): number[] {
  return [...map.keys()].sort((a, b) => b - a); // highest first
}

function sortedAskPrices(map: Map<number, PriceLevel>): number[] {
  return [...map.keys()].sort((a, b) => a - b); // lowest first
}

function removeDepleted(map: Map<number, PriceLevel>, price: number): void {
  const level = map.get(price);
  if (level && level.totalQty <= 0) {
    map.delete(price);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main match function
//  Mutates the in-memory book and balance maps.
//  Returns a list of fills that the caller must persist to the DB.
// ─────────────────────────────────────────────────────────────────────────────
export function match(params: {
  incomingOrderId: string;
  userId: string;
  symbol: string;
  stockId: string;
  side: Side;
  type: OrderType;
  qty: number;
  price?: number; // undefined for MARKET
}): MatchResult {
  const { incomingOrderId, userId, symbol, stockId, side, type, qty, price } =
    params;

  const book = ensureBook(symbol);
  const fills: MatchedFill[] = [];
  let remainingQty = qty;

  // ── BUY order: match against asks ────────────────────────────────────────
  if (side === "BUY") {
    const askPrices = sortedAskPrices(book.asks);

    for (const askPrice of askPrices) {
      if (remainingQty <= 0) break;

      // For LIMIT orders: only match if ask ≤ limit price
      if (type === "LIMIT" && price !== undefined && askPrice > price) break;

      const level = book.asks.get(askPrice)!;

      for (let i = 0; i < level.orders.length && remainingQty > 0; ) {
        const restingOrder = level.orders[i]!;
        const available = restingOrder.qty - restingOrder.filledQty;
        const fillQty = Math.min(remainingQty, available);

        // Record fill
        fills.push({
          buyOrderId: incomingOrderId,
          sellOrderId: restingOrder.orderId,
          price: askPrice,
          qty: fillQty,
          stockId,
        });

        // Mutate resting order in book
        restingOrder.filledQty += fillQty;
        level.totalQty -= fillQty;
        remainingQty -= fillQty;

        // Update balances
        applyFillToBalances({
          buyerId: userId,
          sellerId: restingOrder.userId,
          symbol,
          price: askPrice,
          qty: fillQty,
        });

        if (restingOrder.filledQty >= restingOrder.qty) {
          level.orders.splice(i, 1); // fully filled — remove from level
        } else {
          i++;
        }
      }

      removeDepleted(book.asks, askPrice);
    }

    // If LIMIT and unfilled qty remains, rest it on the bid side
    if (type === "LIMIT" && remainingQty > 0 && price !== undefined) {
      addToBook(book.bids, price, {
        orderId: incomingOrderId,
        userId,
        qty,
        filledQty: qty - remainingQty,
        createdAt: new Date(),
      });

      // Lock the remaining INR
      lockInr(userId, price * remainingQty);
    }
  }

  // ── SELL order: match against bids ───────────────────────────────────────
  if (side === "SELL") {
    const bidPrices = sortedBidPrices(book.bids);

    for (const bidPrice of bidPrices) {
      if (remainingQty <= 0) break;

      // For LIMIT orders: only match if bid ≥ limit price
      if (type === "LIMIT" && price !== undefined && bidPrice < price) break;

      const level = book.bids.get(bidPrice)!;

      for (let i = 0; i < level.orders.length && remainingQty > 0; ) {
        const restingOrder = level.orders[i]!;
        const available = restingOrder.qty - restingOrder.filledQty;
        const fillQty = Math.min(remainingQty, available);

        fills.push({
          buyOrderId: restingOrder.orderId,
          sellOrderId: incomingOrderId,
          price: bidPrice,
          qty: fillQty,
          stockId,
        });

        restingOrder.filledQty += fillQty;
        level.totalQty -= fillQty;
        remainingQty -= fillQty;

        applyFillToBalances({
          buyerId: restingOrder.userId,
          sellerId: userId,
          symbol,
          price: bidPrice,
          qty: fillQty,
        });

        if (restingOrder.filledQty >= restingOrder.qty) {
          level.orders.splice(i, 1);
        } else {
          i++;
        }
      }

      removeDepleted(book.bids, bidPrice);
    }

    // If LIMIT and unfilled qty remains, rest it on the ask side
    if (type === "LIMIT" && remainingQty > 0 && price !== undefined) {
      addToBook(book.asks, price, {
        orderId: incomingOrderId,
        userId,
        qty,
        filledQty: qty - remainingQty,
        createdAt: new Date(),
      });

      // Lock the remaining shares
      lockStock(userId, symbol, remainingQty);
    }
  }

  return { fills, remainingQty };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function addToBook(
  side: Map<number, PriceLevel>,
  price: number,
  order: BookOrder
): void {
  if (!side.has(price)) {
    side.set(price, { totalQty: 0, orders: [] });
  }
  const level = side.get(price)!;
  level.totalQty += order.qty - order.filledQty;
  level.orders.push(order);
}

function applyFillToBalances(params: {
  buyerId: string;
  sellerId: string;
  symbol: string;
  price: number;
  qty: number;
}): void {
  const { buyerId, sellerId, symbol, price, qty } = params;
  const cost = price * qty;

  // Buyer: deduct locked INR, credit stock
  const buyerBal = BALANCES.get(buyerId);
  if (buyerBal) {
    const inr = buyerBal.INR as { total: number; locked: number };
    inr.total -= cost;
    inr.locked -= cost;

    if (!buyerBal[symbol]) buyerBal[symbol] = { total: 0, locked: 0 };
    (buyerBal[symbol] as { total: number; locked: number }).total += qty;
  }

  // Seller: deduct locked stock, credit INR
  const sellerBal = BALANCES.get(sellerId);
  if (sellerBal) {
    const stock = sellerBal[symbol] as { total: number; locked: number } | undefined;
    if (stock) {
      stock.total -= qty;
      stock.locked -= qty;
    }
    const inr = sellerBal.INR as { total: number; locked: number };
    inr.total += cost;
  }
}

function lockInr(userId: string, amount: number): void {
  const bal = BALANCES.get(userId);
  if (!bal) return;
  const inr = bal.INR as { total: number; locked: number };
  inr.locked += amount;
}

function lockStock(userId: string, symbol: string, qty: number): void {
  const bal = BALANCES.get(userId);
  if (!bal) return;
  if (!bal[symbol]) bal[symbol] = { total: 0, locked: 0 };
  (bal[symbol] as { total: number; locked: number }).locked += qty;
}