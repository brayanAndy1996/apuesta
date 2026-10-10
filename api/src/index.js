import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
const server = createServer(app);

export const io = new Server(server, {
  cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" },
});

server.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
