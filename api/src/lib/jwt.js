import { SignJWT, jwtVerify } from "jose";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en producción");
}

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-insecure-secret-cambiar-en-prod",
);
const TTL = "12h";

export async function signToken(user) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, secret);
  return payload;
}
