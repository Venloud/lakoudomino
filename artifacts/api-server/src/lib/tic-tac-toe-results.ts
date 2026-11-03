import type { TicTacToeMode } from "lakou-engine";

type CompletedRoom = {
  code: string;
  mode: TicTacToeMode;
  status: "waiting" | "playing" | "finished";
  roundNumber: number;
  players: Array<{
    seat: 0 | 1;
    mark: "X" | "O";
    name: string;
    userId?: string | null;
  }>;
  state: { winner: "X" | "O" | null; isDraw: boolean };
};

export type TicTacToeResultInsert = {
  roomCode: string;
  roundNumber: number;
  userId: string;
  mode: TicTacToeMode;
  outcome: "win" | "loss" | "draw";
  mark: "X" | "O";
  opponentName: string;
};

export function buildTicTacToeResultInserts(room: CompletedRoom): TicTacToeResultInsert[] {
  if (room.status !== "finished" || (!room.state.winner && !room.state.isDraw) || room.players.length !== 2) {
    return [];
  }
  const [first, second] = room.players;
  if (first.userId && first.userId === second.userId) return [];
  return room.players.filter((player) => player.userId).map((player) => ({
    roomCode: room.code,
    roundNumber: room.roundNumber,
    userId: player.userId!,
    mode: room.mode,
    outcome: room.state.isDraw ? "draw" : room.state.winner === player.mark ? "win" : "loss",
    mark: player.mark,
    opponentName: room.players.find((opponent) => opponent.seat !== player.seat)!.name,
  }));
}
