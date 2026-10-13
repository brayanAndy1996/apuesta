import { io, type Socket } from "socket.io-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

// Socket.IO compartido: una conexión por pestaña, canales por sala.
export function roomSocket(code: string): Socket {
  if (!socket) {
    socket = io(API_URL, { transports: ["websocket", "polling"] });
  }
  socket.emit("join:room", code.toUpperCase());
  return socket;
}
