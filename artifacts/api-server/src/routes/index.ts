import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import authRouter from "./auth";
import friendsRouter from "./friends";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomsRouter);
router.use(authRouter);
router.use(friendsRouter);

export default router;
