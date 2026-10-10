import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashCredential } from "../lib/crypto.js";
import { publicUser, ROLES, User } from "../models/user.js";

const pin = z.string().regex(/^\d{4,6}$/, "el PIN debe tener entre 4 y 6 dígitos");

const createSchema = z.object({
  name: z.string().trim().min(1).max(128),
  pin,
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    pin: pin.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "nada que actualizar" });

// Genera un username único a partir del nombre: "Rosa Quispe" → "rosa.quispe"
// (o "rosa.quispe2", "rosa.quispe3", … si ya existe).
async function uniqueUsername(name) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita marcas diacríticas (á→a, ñ→n)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "") || "cajero";

  let candidate = base;
  for (let i = 2; ; i += 1) {
    const exists = await User.findOne({ where: { username: candidate } });
    if (!exists) return candidate;
    candidate = `${base}${i}`;
  }
}

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(ROLES.ADMIN));

adminRouter.post("/cashiers", async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  try {
    const { name, pin: rawPin } = parsed.data;
    const user = await User.create({
      role: ROLES.CASHIER,
      username: await uniqueUsername(name),
      name,
      credentialHash: await hashCredential(rawPin),
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/cashiers", async (_req, res, next) => {
  try {
    const cashiers = await User.findAll({
      where: { role: ROLES.CASHIER },
      order: [["createdAt", "ASC"]],
    });
    res.json({ cashiers: cashiers.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/cashiers/:id", async (req, res, next) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  try {
    const cashier = await User.findOne({
      where: { id: req.params.id, role: ROLES.CASHIER },
    });
    if (!cashier) {
      return res.status(404).json({ error: "cajero no encontrado" });
    }
    const { name, pin: newPin, active } = parsed.data;
    if (name !== undefined) cashier.name = name;
    if (active !== undefined) cashier.active = active;
    if (newPin !== undefined) cashier.credentialHash = await hashCredential(newPin);
    await cashier.save();
    res.json({ user: publicUser(cashier) });
  } catch (err) {
    next(err);
  }
});
