import express from "express";
import { createServer } from "node:http";
import roomsRouter, {
  attachRoomWebSocket,
  initializeRooms,
  isRoomRetryListenerConnected,
} from "./rooms.ts";
import ticTacToeRouter from "./tic-tac-toe.ts";
import healthRouter from "./health.ts";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const app = express();
app.use(express.json());
app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
app.get("/__test/room-retry-listener", (_request, response) => {
  response.json({ connected: isRoomRetryListenerConnected() });
});
app.use(healthRouter);
app.use("/api", roomsRouter);
app.use("/api", ticTacToeRouter);

const server = createServer(app);
attachRoomWebSocket(server);
await initializeRooms();
server.listen(port, "127.0.0.1");
