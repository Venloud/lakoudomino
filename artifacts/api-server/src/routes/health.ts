import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getArcadeNotificationListenerHealth } from "./arcade.ts";
import { getRoomRecoveryDiagnostics } from "../lib/room-persistence.ts";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    roomRecovery: getRoomRecoveryDiagnostics(),
    arcadeRoomUpdates: getArcadeNotificationListenerHealth(),
  });
  res.json(data);
});

export default router;
