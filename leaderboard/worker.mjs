// Array Acres leaderboard: a Cloudflare Worker that keeps a top 10 per farm.
//
// It never trusts a score on its own. A submission waits as "checking" until the scheduled
// GitHub job (leaderboard/verify.js) replays the player's code with the game's own rules and
// reports the score it earns. Only a score the code really earns goes on the board.
//
// Storage is a D1 database, bound as DB (tables in leaderboard/schema.sql). Each change is a
// single statement or batch, so simultaneous submissions and checks can't overwrite each other.
// Secret: LEADERBOARD_TOKEN, shared with the GitHub job, for /pending and /verify.

export const RULESET = 'v2';
export const FARMS = ['middlebourne-farm', 'sunnyhill-farm', 'marshgate-farm', 'crowhurst-farm', 'blightwick-farm'];
// Experimental farms have versioned boards. When an experiment's rules change, bump its number
// here and its boardVersion in the game's farm list, and its board starts fresh.
export const VERSIONS = { 'crowhurst-farm': 1, 'blightwick-farm': 1 };
export const SIZE = 10;
export const MAX_PENDING = 20;          // per board
export const PENDING_HOURS = 24;        // unchecked entries expire after this
export const SUBMITS_PER_HOUR = 10;     // per sender
const MAX_CODE = 4000;

const versionOf = farm => VERSIONS[farm] || 0;
export const boardOf = (farm, version = versionOf(farm)) => `${RULESET}:${farm}${version ? `:${version}` : ''}`;

// Three letters is enough to be rude: these are refused.
export const BLOCKED = new Set(['ASS', 'CNT', 'COK', 'CUM', 'DIC', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'FUQ', 'JIZ',
  'KKK', 'KYS', 'NAZ', 'NGR', 'NIG', 'PIS', 'PUS', 'SEX', 'SHT', 'TIT', 'VAG', 'WTF', 'XXX']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' },
});

const ago = (now, hours) => new Date(now - hours * 3600e3).toISOString();

function authorised(request, env) {
  const got = request.headers.get('authorization') || '', want = `Bearer ${env.LEADERBOARD_TOKEN || ''}`;
  if (!env.LEADERBOARD_TOKEN || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// The sender is remembered only as a hash of their address, and only for an hour.
async function senderOf(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`array-acres:${ip}`));
  return [...new Uint8Array(hash)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Would this score earn a place on the board, as a new best for these initials?
async function qualifies(db, board, initials, score) {
  const mine = await db.prepare('SELECT score FROM entries WHERE board = ? AND initials = ?').bind(board, initials).first();
  if (mine && mine.score >= score) return false;
  const { results } = await db.prepare('SELECT score FROM entries WHERE board = ? AND initials != ? ORDER BY score DESC, date ASC LIMIT ?')
    .bind(board, initials, SIZE).all();
  return results.length < SIZE || score > results[results.length - 1].score;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), db = env.DB, now = env.now ? env.now() : Date.now();
    if (request.method === 'OPTIONS') return json({});

    // The board for one farm: the top 10 verified scores, and how many are still being checked. Unchecked
    // scores are only counted, never listed, so nobody can post a fake score even briefly. (pending stays,
    // empty, for pages loaded before this change.)
    if (request.method === 'GET' && url.pathname === '/board') {
      const farm = url.searchParams.get('farm');
      if (!FARMS.includes(farm)) return json({ error: 'unknown-farm' }, 400);
      const board = boardOf(farm);
      const entries = (await db.prepare('SELECT initials, score, date FROM entries WHERE board = ? ORDER BY score DESC, date ASC LIMIT ?').bind(board, SIZE).all()).results;
      const { n: checking } = await db.prepare('SELECT COUNT(*) AS n FROM pending WHERE board = ? AND date >= ?').bind(board, ago(now, PENDING_HOURS)).first();
      return json({ ruleset: RULESET, farm, version: versionOf(farm), entries, checking, pending: [] });
    }

    // A player's score and the code that earned it, waiting to be checked.
    if (request.method === 'POST' && url.pathname === '/submit') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad-request' }, 400); }
      const { farm, code } = body || {}, initials = String(body && body.initials || '').toUpperCase(), score = Number(body && body.score);
      if (!FARMS.includes(farm)) return json({ error: 'unknown-farm' }, 400);
      if (!/^[A-Z]{3}$/.test(initials)) return json({ error: 'initials' }, 400);
      if (BLOCKED.has(initials)) return json({ error: 'initials-not-allowed' }, 400);
      if (!Number.isInteger(score) || score < 0 || score > 100000) return json({ error: 'bad-score' }, 400);
      if (typeof code !== 'string' || !code.length || code.length > MAX_CODE) return json({ error: 'bad-code' }, 400);
      const version = Number(body.version || 0);
      if (version !== versionOf(farm)) return json({ error: 'outdated' }, 409);
      const board = boardOf(farm);

      // Tidy up: forget old senders, and let unchecked entries expire so a stalled checker can't jam the queue.
      await db.batch([
        db.prepare('DELETE FROM submissions WHERE date < ?').bind(ago(now, 1)),
        db.prepare('DELETE FROM pending WHERE date < ?').bind(ago(now, PENDING_HOURS)),
      ]);
      const sender = await senderOf(request);
      const sent = await db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE sender = ?').bind(sender).first();
      if (sent.n >= SUBMITS_PER_HOUR) return json({ error: 'rate-limited' }, 429);
      await db.prepare('INSERT INTO submissions (sender, date) VALUES (?, ?)').bind(sender, new Date(now).toISOString()).run();

      if (!(await qualifies(db, board, initials, score))) return json({ error: 'not-high-enough' }, 409);
      const waiting = await db.prepare('SELECT COUNT(*) AS n FROM pending WHERE board = ? AND initials != ?').bind(board, initials).first();
      if (waiting.n >= MAX_PENDING) return json({ error: 'busy' }, 503);

      // One entry waiting per initials per board: a better score replaces it, a worse one is refused.
      const id = crypto.randomUUID(), date = new Date(now).toISOString();
      const res = await db.prepare(`INSERT INTO pending (id, board, farm, version, initials, score, code, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (board, initials) DO UPDATE SET id = excluded.id, score = excluded.score, code = excluded.code, date = excluded.date
        WHERE excluded.score > pending.score`).bind(id, board, farm, version, initials, score, code, date).run();
      if (!res.meta.changes) return json({ error: 'not-high-enough' }, 409);
      return json({ status: 'checking' });
    }

    // For the GitHub job only: everything waiting to be checked, with its code.
    if (request.method === 'GET' && url.pathname === '/pending') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      const pending = (await db.prepare('SELECT * FROM pending WHERE date >= ? ORDER BY date').bind(ago(now, PENDING_HOURS)).all()).results
        .map(p => ({ ...p, ruleset: RULESET }));
      return json({ pending });
    }

    // For the GitHub job only: the score the code really earned. A match goes on the board.
    if (request.method === 'POST' && url.pathname === '/verify') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad-request' }, 400); }
      const { id, score } = body || {};
      if (typeof id !== 'string' || !Number.isInteger(score)) return json({ error: 'bad-request' }, 400);
      const entry = await db.prepare('SELECT * FROM pending WHERE id = ?').bind(id).first();
      if (!entry) return json({ error: 'unknown-entry' }, 404);
      const accepted = score === entry.score && entry.board === boardOf(entry.farm);
      // Removing the entry and keeping its score happen together, and only a new best is kept.
      await db.batch([
        db.prepare('DELETE FROM pending WHERE id = ?').bind(id),
        ...(accepted ? [db.prepare(`INSERT INTO entries (board, initials, score, date) VALUES (?, ?, ?, ?)
          ON CONFLICT (board, initials) DO UPDATE SET score = excluded.score, date = excluded.date WHERE excluded.score > entries.score`)
          .bind(entry.board, entry.initials, entry.score, entry.date)] : []),
      ]);
      return json({ accepted });
    }

    return json({ error: 'not-found' }, 404);
  },
};
