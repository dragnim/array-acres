-- Array Acres leaderboard: the D1 database behind leaderboard/worker.mjs.
-- Run once in the D1 console (or with wrangler d1 execute) to create the tables.

-- Verified scores: each player's best on each board. A board is a ruleset and farm, plus a
-- version for experimental farms, such as "v2:middlebourne-farm" or "v2:crowhurst-farm:1".
CREATE TABLE IF NOT EXISTS entries (
  board TEXT NOT NULL,
  initials TEXT NOT NULL,
  score INTEGER NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (board, initials)
);

-- Scores waiting to be checked, with the code that earned them. One per initials per board.
CREATE TABLE IF NOT EXISTS pending (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL,
  farm TEXT NOT NULL,
  version INTEGER NOT NULL,
  initials TEXT NOT NULL,
  score INTEGER NOT NULL,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  UNIQUE (board, initials)
);

-- Recent submissions, by a hash of the sender's address, for rate limiting. Kept for an hour.
CREATE TABLE IF NOT EXISTS submissions (
  sender TEXT NOT NULL,
  date TEXT NOT NULL
);
