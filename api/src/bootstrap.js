import { hashCredential } from "./lib/crypto.js";
import { ROLES, User } from "./models/user.js";

// Crea el administrador inicial si no existe ninguno.
// Credenciales por env: ADMIN_USERNAME / ADMIN_PASSWORD.
export async function ensureAdmin() {
  const existing = await User.findOne({ where: { role: ROLES.ADMIN } });
  if (existing) return existing;

  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD es obligatorio en producción");
  }

  const username = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "admin1234";
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD no definido: usando contraseña de demo (solo desarrollo)");
  }

  return User.create({
    role: ROLES.ADMIN,
    username,
    name: "Administrador",
    credentialHash: await hashCredential(password),
  });
}
