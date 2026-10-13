import cors from "cors";
import express from "express";

import { sequelize } from "./db.js";
import { adminRouter } from "./routes/admin.js";
import { adminRoomsRouter } from "./routes/adminRooms.js";
import { authRouter } from "./routes/auth.js";
import { roomsRouter } from "./routes/rooms.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    }),
  );
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    try {
      await sequelize.authenticate();
      res.status(200).json({ status: "ok", db: "up" });
    } catch {
      res.status(503).json({ status: "degraded", db: "down" });
    }
  });

  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/admin/rooms", adminRoomsRouter);
  app.use("/rooms", roomsRouter);

  app.use((_req, res) => res.status(404).json({ error: "no encontrado" }));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "error interno" });
  });

  return app;
}
