import { createServer } from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import arcadeRouter, {
  handleArcadeSocket,
  initializeArcadeRooms,
  disconnectArcadeNotificationListenerForTest,
  interruptArcadeNotificationListenerForTest,
  maintainArcadeRoomsForTest,
  resumeArcadeNotificationListenerForTest,
} from "./arcade.ts";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const app = express();
app.use(express.json());
app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
app.post("/__test/interrupt-notification-listener", (_request, response) => {
  const interrupted = interruptArcadeNotificationListenerForTest();
  response.status(interrupted ? 200 : 409).json({ interrupted });
});
app.post("/__test/disconnect-notification-listener", (_request, response) => {
  const disconnected = disconnectArcadeNotificationListenerForTest();
  response.status(disconnected ? 200 : 409).json({ disconnected });
});
app.post("/__test/resume-notification-listener", (_request, response) => {
  resumeArcadeNotificationListenerForTest();
  response.json({ resumed: true });
});
app.post("/__test/maintain-rooms", async (request, response) => {
  const pauseAfterRefreshMs = Number(request.query.pauseAfterRefreshMs ?? 0);
  let respondedAfterRefresh = false;
  await maintainArcadeRoomsForTest(async () => {
    if (Number.isFinite(pauseAfterRefreshMs) && pauseAfterRefreshMs > 0) {
      response.json({ refreshed: true });
      respondedAfterRefresh = true;
      await new Promise<void>((resolvePause) => setTimeout(resolvePause, Math.min(pauseAfterRefreshMs, 1_000)));
    }
  });
  if (!respondedAfterRefresh) response.json({ maintained: true });
});
app.use("/api", arcadeRouter);

const server = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (!url.searchParams.has("arcadeCode")) {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    handleArcadeSocket(client, request);
  });
});

await initializeArcadeRooms();
server.listen(port, "127.0.0.1");
