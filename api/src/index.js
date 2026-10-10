import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { ensureAdmin, ensureGeneralRoom } from "./bootstrap.js";
import { processExpiredRounds, setIo } from "./services/roundService.js";

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
const server = createServer(app);

export const io = new Server(server, {
  cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" },
});

setIo(io);
io.on("connection", (socket) => {
  socket.on("join:room", (code) => {
    if (typeof code === "string" && code.length <= 16) {
      socket.join(`room:${code.toUpperCase()}`);
    }
  });
});

await ensureAdmin();
await ensureGeneralRoom();
console.log("admin inicial y sala general verificados");

// Ticker del ciclo de rondas: revisa deadlines persistidos cada 500 ms.
setInterval(() => {
  processExpiredRounds().catch((err) =>
    console.error("error procesando rondas vencidas", err),
  );
}, 500);

server.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
