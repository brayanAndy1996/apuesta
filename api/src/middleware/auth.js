import { verifyToken } from "../lib/jwt.js";
import { User } from "../models/user.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "token requerido" });
  }

  try {
    const payload = await verifyToken(token);
    const user = await User.findByPk(payload.sub);
    if (!user || !user.active) {
      return res.status(401).json({ error: "token inválido" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "token inválido" });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "sin permiso" });
    }
    next();
  };
}
