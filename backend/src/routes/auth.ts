import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { BALANCES } from "../lib/store.js";
import { signToken } from "../middleware/auth.js";
import type { RegisterBody, LoginBody } from "../types/index.js";

export const authRouter = Router();

// POST /auth/register
authRouter.post(
  "/register",
  async (req: Request<{}, {}, RegisterBody>, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, passwordHash },
    });

    // Initialise in-memory balance for this user
    BALANCES.set(user.id, { INR: { total: 0, locked: 0 } });

    const token = signToken(user.id);
    res.status(201).json({ token, userId: user.id });
  }
);

// POST /auth/login
authRouter.post(
  "/login",
  async (req: Request<{}, {}, LoginBody>, res: Response) => {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken(user.id);
    res.json({ token, userId: user.id });
  }
);