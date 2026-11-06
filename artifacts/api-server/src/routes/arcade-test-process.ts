import { createServer } from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import authRouter from "./auth.ts";
import arcadeRouter, {
  handleArcadeSocket,
  getArcadeNotificationListenerHealth,
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
app.get("/healthz", (_request, response) => response.json({
  status: "ok",
  arcadeRoomUpdates: getArcadeNotificationListenerHealth(),
}));
app.get("/__test/arcade-notification-health", (_request, response) => {
  response.json(getArcadeNotificationListenerHealth());
});
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
  const failAfterRefresh = request.query.failAfterRefresh === "true";
  let respondedAfterRefresh = false;
  try {
    await maintainArcadeRoomsForTest(async () => {
      if (failAfterRefresh) throw new Error("Injected maintenance failure after room refresh.");
      if (Number.isFinite(pauseAfterRefreshMs) && pauseAfterRefreshMs > 0) {
        response.json({ refreshed: true });
        respondedAfterRefresh = true;
        await new Promise<void>((resolvePause) => setTimeout(resolvePause, Math.min(pauseAfterRefreshMs, 1_000)));
      }
    });
    if (!respondedAfterRefresh) response.json({ maintained: true });
  } catch (error) {
    if (failAfterRefresh) {
      response.status(500).json({ error: "Maintenance failed." });
      return;
    }
    throw error;
  }
});
app.use("/api", arcadeRouter);
app.use("/api", authRouter);

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
