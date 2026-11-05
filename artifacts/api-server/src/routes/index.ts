import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import authRouter from "./auth";
import friendsRouter from "./friends";
import ticTacToeRouter from "./tic-tac-toe";
import wordYardRouter from "./word-yard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomsRouter);
router.use(authRouter);
router.use(friendsRouter);
router.use(ticTacToeRouter);
router.use(wordYardRouter);

export default router;
