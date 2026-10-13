import { hashCredential } from "./lib/crypto.js";
import { DEFAULT_SLOTS, GENERAL_ROOM_CODE, Room, RoomSlot } from "./models/room.js";
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

// Crea la sala general (R4) con las casillas por defecto si no existe.
export async function ensureGeneralRoom() {
  const existing = await Room.findOne({ where: { code: GENERAL_ROOM_CODE } });
  if (existing) return existing;

  const room = await Room.create({
    code: GENERAL_ROOM_CODE,
    name: "Sala general",
  });
  await RoomSlot.bulkCreate(
    DEFAULT_SLOTS.map((slot) => ({ ...slot, roomId: room.id })),
  );
  return room;
}
