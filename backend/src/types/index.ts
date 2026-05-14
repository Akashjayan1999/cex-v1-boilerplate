// ─────────────────────────────────────────────────────────────────────────────
//  In-Memory types
//  These structures live purely in the Node process and are rebuilt on startup
//  by replaying OPEN/PARTIAL orders from the database.
// ─────────────────────────────────────────────────────────────────────────────

export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";

// One resting order inside the book
export interface BookOrder {
  orderId: string; // PK in the DB orders table
  userId: string;
  qty: number;
  filledQty: number;
  createdAt: Date;
}

// A price level: all resting orders at the same price
export interface PriceLevel {
  totalQty: number; // sum of (qty - filledQty) across orders
  orders: BookOrder[];
}

// Per-symbol order book
// BIDS: keyed by price descending (best bid = highest price)
// ASKS: keyed by price ascending  (best ask = lowest price)
export interface SymbolBook {
  bids: Map<number, PriceLevel>; // price → level
  asks: Map<number, PriceLevel>;
}

// The global order book: symbol → book
export type OrderBook = Map<string, SymbolBook>;

// ─────────────────────────────────────────────────────────────────────────────
//  Balance types
//  INR balance tracks locked funds (placed in BUY limit orders).
//  Stock balances track locked shares  (placed in SELL limit orders).
// ─────────────────────────────────────────────────────────────────────────────

export interface InrBalance {
  total: number; // total INR held
  locked: number; // committed to open BUY orders
}

export interface StockBalance {
  total: number; // total shares held
  locked: number; // committed to open SELL orders
}

// userId → { INR: InrBalance, [symbol]: StockBalance }
export type UserBalances = {
  INR: InrBalance;
  [symbol: string]: StockBalance | InrBalance;
};

export type Balances = Map<string, UserBalances>;

// ─────────────────────────────────────────────────────────────────────────────
//  Matching engine output
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchedFill {
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  qty: number;
  stockId: string;
}

export interface MatchResult {
  fills: MatchedFill[];
  remainingQty: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP request shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceOrderBody {
  userId: string;
  stockId: string;
  side: Side;
  type: OrderType;
  qty: number;
  price?: number; // required for LIMIT, absent for MARKET
}

export interface RegisterBody {
  username: string;
  password: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

export interface OnRampBody {
  userId: string;
  amount: number;
}