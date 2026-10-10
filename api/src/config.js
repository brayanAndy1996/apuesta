import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carga mínima de .env para que sequelize-cli (que no pasa por index.js)
// vea DATABASE_URL sin dependencias extra.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  // .env es opcional
}

const url = new URL(
  process.env.DATABASE_URL ?? "postgres://apuesta:apuesta@localhost:5432/apuesta",
);

const config = {
  dialect: "postgres",
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, ""),
  username: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  logging: process.env.DB_LOGGING === "true" ? console.log : false,
};

export default {
  development: config,
  test: config,
  production: config,
};
