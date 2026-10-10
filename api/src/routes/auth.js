import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { verifyCredential } from "../lib/crypto.js";
import { signToken } from "../lib/jwt.js";
import { Room } from "../models/room.js";
import { publicUser, ROLES, User } from "../models/user.js";

const INVALID = { error: "credenciales inválidas" };

// Hash scrypt válido de un valor dummy: hace que un login con usuario
// inexistente cueste lo mismo que uno real y no filtre usuarios por tiempo.
const DUMMY_HASH =
  "scrypt$16384$8$1$1t7ZWRnkBOY7nPKkdb0JOQ==$8GyOFR7eB0SNqq0kYspdnhad3luXOhjGvZOm8v5vHHnAfMwBlv7uDFmAa2/J/N+9qRLLzq5CEq52oUKMjZ05og==";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const pinSchema = z.object({
  username: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4,6}$/),
});

async function loginWithRole(req, res, role, credential) {
  const username = req.body.username.toLowerCase();
  const user = await User.scope("withCredentials").findOne({
    where: { username, role },
  });
  // Compara igual aunque el usuario no exista para no filtrar usernames por tiempo.
  const stored = user?.credentialHash ?? DUMMY_HASH;
  const ok = user && user.active && (await verifyCredential(credential, stored));
  if (!ok) {
    return res.status(401).json(INVALID);
  }
  const token = await signToken(user);
  res.json({ token, user: publicUser(user) });
}

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  try {
    await loginWithRole(req, res, ROLES.ADMIN, parsed.data.password);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/pin", async (req, res, next) => {
  const parsed = pinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  try {
    await loginWithRole(req, res, ROLES.CASHIER, parsed.data.pin);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    // El cajero necesita saber qué sala atiende (una por R10).
    const room =
      req.user.role === "cashier"
        ? await Room.findOne({ where: { cashierId: req.user.id, active: true } })
        : null;
    res.json({
      user: publicUser(req.user),
      room: room ? { code: room.code, name: room.name } : null,
    });
  } catch (err) {
    next(err);
  }
});
