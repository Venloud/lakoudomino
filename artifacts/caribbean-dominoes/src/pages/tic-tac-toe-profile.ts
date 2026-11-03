import { createElement } from "react";
import type { TicTacToeResultsResponse } from "@workspace/api-client-react";

const h = createElement;

export function TicTacToeProfileResults({
  data,
  isLoading = false,
  isError = false,
  onRetry,
}: {
  data?: TicTacToeResultsResponse;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  if (isLoading) {
    return h("div", { className: "yard-loading", "data-testid": "loading-tic-tac-toe-results" },
      h("i", { className: "yard-skeleton" }),
      h("i", { className: "yard-skeleton" }),
    );
  }
  if (isError) {
    return h("div", { className: "yard-empty", role: "alert", "data-testid": "error-tic-tac-toe-results" },
      h("strong", null, "Tic-Tac-Toe results are unavailable"),
      h("p", null, "We couldn't load your saved results."),
      onRetry ? h("button", { className: "yard-button", onClick: onRetry, "data-testid": "button-retry-tic-tac-toe-results" }, "Try again") : null,
    );
  }
  if (!data) return null;
  const summary = data.summary;
  return h("div", { "data-testid": "tic-tac-toe-profile-results" },
    h("div", { className: "yard-tic-profile-stats", "aria-label": "Tic-Tac-Toe record" },
      ...([
        ["Games", summary.games],
        ["Wins", summary.wins],
        ["Losses", summary.losses],
        ["Draws", summary.draws],
      ] as const).map(([label, value]) => h("div", { className: "yard-profile-stat", key: label },
        h("strong", null, String(value)),
        h("span", null, label),
      )),
    ),
    data.results.length
      ? h("div", { className: "yard-tic-profile-history", "aria-label": "Recent Tic-Tac-Toe matches" },
        ...data.results.map((result) => h("div", {
          className: "yard-tic-profile-result",
          key: result.id,
          "data-testid": `tic-tac-toe-result-${result.id}`,
        },
        h("span", { className: `yard-tic-result-badge is-${result.outcome}` }, result.outcome === "win" ? "W" : result.outcome === "loss" ? "L" : "D"),
        h("span", null,
          h("b", null, result.outcome === "win" ? "Victory" : result.outcome === "loss" ? "Defeat" : "Draw"),
          h("small", null, `${result.mode === "yard" ? "Yard Mode" : "Regular"} · vs ${result.opponentName} · ${new Date(result.completedAt).toLocaleDateString()}`),
        ),
        h("strong", { className: "yard-tic-result-mark" }, result.mark),
        )),
      )
      : h("div", { className: "yard-empty", "data-testid": "empty-tic-tac-toe-results" },
        h("strong", null, "No Tic-Tac-Toe matches yet"),
        h("p", null, "Complete an online match while signed in to start your record."),
      ),
  );
}
