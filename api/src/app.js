import express from "express";

import { sequelize } from "./db.js";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", async (_req, res) => {
    try {
      await sequelize.authenticate();
      res.status(200).json({ status: "ok", db: "up" });
    } catch {
      res.status(503).json({ status: "degraded", db: "down" });
    }
  });

  return app;
}
