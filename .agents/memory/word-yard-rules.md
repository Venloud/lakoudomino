---
name: Word Yard game rules
description: Product rules that distinguish Word Yard from the separate Scrabble game.
---

Word Yard is a simultaneous Wordle-like game, not Scrabble. Two to four players receive the same secret word and guess independently; each player's guesses and feedback stay private. Words are 4–7 letters with six attempts. Fewer guesses score higher, solve time breaks ties, and Party mode spans multiple rounds.

**Why:** the user explicitly defined Word Yard as a separate multiplayer word-guessing game and kept Scrabble as its own game.

**How to apply:** keep Word Yard at `/games/words`, Scrabble at `/games/scrabble`, and keep the answer/guess validation authoritative on the server.
