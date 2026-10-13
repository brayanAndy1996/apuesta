import { createHash, randomBytes } from "node:crypto";

export function newSeed() {
  return randomBytes(32).toString("hex");
}

export function seedHash(seed) {
  return createHash("sha256").update(seed).digest("hex");
}
