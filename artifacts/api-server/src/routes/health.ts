import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getArcadeNotificationListenerHealth } from "./arcade.ts";
import {
  getRoomRecoveryDiagnostics,
  retryQuarantinedRoom,
  type QuarantinedRoomRetryResult,
} from "../lib/room-persistence.ts";
import { logger } from "../lib/logger.ts";
import { activateRecoveredRoom } from "./rooms.ts";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    roomRecovery: getRoomRecoveryDiagnostics(),
    arcadeRoomUpdates: getArcadeNotificationListenerHealth(),
  });
  res.json(data);
});

type RetryHandlerDependencies = {
  getOperatorToken: () => string | undefined;
  retryRoom: (roomCode: string) => Promise<QuarantinedRoomRetryResult>;
  activateRoom: (room: Extract<QuarantinedRoomRetryResult, { status: "restored" }>["room"]) => Promise<boolean>;
  audit: (result: "restored" | "not_found" | "invalid" | "already_active" | "failed", issuePaths?: string[]) => void;
};

function hasValidOperatorToken(request: Request, configuredToken: string | undefined): boolean {
  if (!configuredToken) return false;
  const authorization = request.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(configuredToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createRoomRetryHandler({
  getOperatorToken,
  retryRoom,
  activateRoom,
  audit,
}: RetryHandlerDependencies) {
  return async (request: Request, response: Response): Promise<void> => {
    const operatorToken = getOperatorToken();
    if (!operatorToken) {
      response.status(503).json({ error: "Room recovery retry is not configured" });
      return;
    }
    if (!hasValidOperatorToken(request, operatorToken)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const roomCode = request.params["code"];
    if (typeof roomCode !== "string" || roomCode.length > 32) {
      response.status(400).json({ error: "Invalid room code" });
      return;
    }

    let result: QuarantinedRoomRetryResult;
    try {
      result = await retryRoom(roomCode);
      if (result.status === "invalid") {
        audit("invalid", result.issuePaths);
        response.status(422).json({ error: "Saved room data is still invalid", issuePaths: result.issuePaths });
        return;
      }
      if (result.status === "not_found") {
        audit("not_found");
        response.status(404).json({ error: "Quarantined room not found" });
        return;
      }
      if (!await activateRoom(result.room)) {
        audit("already_active");
        response.status(409).json({ error: "Room is already active in this server" });
        return;
      }
      audit("restored");
      response.json({ status: "restored" });
    } catch {
      audit("failed");
      response.status(500).json({ error: "Room recovery retry failed" });
    }
  };
}

router.post("/ops/rooms/:code/retry", createRoomRetryHandler({
  getOperatorToken: () => process.env.ROOM_RECOVERY_OPERATOR_TOKEN,
  retryRoom: retryQuarantinedRoom,
  activateRoom: activateRecoveredRoom,
  audit(result, issuePaths) {
    logger.info({
      event: "persisted_room_retry",
      result,
      ...(issuePaths ? { issuePaths } : {}),
    }, "Operator requested persisted room retry");
  },
}));

export default router;
