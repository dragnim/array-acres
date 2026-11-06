// Array Acres leaderboard: a Cloudflare Worker that keeps a top 10 per farm.
//
// It never trusts a score on its own. A submission waits as "checking" until the scheduled
// GitHub job (leaderboard/verify.js) replays the player's code with the game's own rules and
// reports the score it earns. Only a score the code really earns goes on the board.
//
// Storage (Workers KV, bound as LB):
//   board:<ruleset>:<farm>  { entries: [{ initials, score, date }], pending: [{ id, initials, score, date }] }
//   pending:<id>            { id, ruleset, farm, version, initials, score, code, date }
// Experimental farms' boards have a version on the end of their key, so a new version starts fresh.
// Secret: LEADERBOARD_TOKEN, shared with the GitHub job, for /pending and /verify.

export const RULESET = 'v2';
export const FARMS = ['middlebourne-farm', 'sunnyhill-farm', 'marshgate-farm', 'crowhurst-farm'];
// Experimental farms have versioned boards. When an experiment's rules change, bump its number
// here and its boardVersion in the game's farm list, and its board starts fresh.
export const VERSIONS = { 'crowhurst-farm': 1 };
const versionOf = farm => VERSIONS[farm] || 0;
export const SIZE = 10;
const MAX_PENDING = 20, MAX_CODE = 4000;

// Three letters is enough to be rude: these are refused.
export const BLOCKED = new Set(['ASS', 'CNT', 'COK', 'CUM', 'DIC', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'FUQ', 'JIZ',
  'KKK', 'KYS', 'NAZ', 'NGR', 'NIG', 'PIS', 'PUS', 'SEX', 'SHT', 'TIT', 'VAG', 'WTF', 'XXX']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' },
});

// Best first; equal scores keep whoever got there first.
const rank = entries => entries.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, SIZE);

// Would this score earn a place on the board, as a new best for these initials?
export function qualifies(board, initials, score) {
  const mine = board.entries.find(e => e.initials === initials);
  if (mine && mine.score >= score) return false;
  const others = board.entries.filter(e => e.initials !== initials);
  return others.length < SIZE || score > Math.min(...others.map(e => e.score));
}

const boardKey = farm => `board:${RULESET}:${farm}${versionOf(farm) ? `:${versionOf(farm)}` : ''}`;
async function getBoard(env, farm) {
  return (await env.LB.get(boardKey(farm), 'json')) || { entries: [], pending: [] };
}
const putBoard = (env, farm, board) => env.LB.put(boardKey(farm), JSON.stringify(board));

function authorised(request, env) {
  const got = request.headers.get('authorization') || '', want = `Bearer ${env.LEADERBOARD_TOKEN || ''}`;
  if (!env.LEADERBOARD_TOKEN || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({});

    // The board for one farm: verified entries, plus scores still being checked.
    if (request.method === 'GET' && url.pathname === '/board') {
      const farm = url.searchParams.get('farm');
      if (!FARMS.includes(farm)) return json({ error: 'unknown-farm' }, 400);
      const b = await getBoard(env, farm);
      return json({ ruleset: RULESET, farm, version: versionOf(farm), entries: b.entries, pending: b.pending.map(({ initials, score, date }) => ({ initials, score, date })) });
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
      const board = await getBoard(env, farm);
      if (!qualifies(board, initials, score)) return json({ error: 'not-high-enough' }, 409);
      if (board.pending.length >= MAX_PENDING) return json({ error: 'busy' }, 503);
      const entry = { id: crypto.randomUUID(), ruleset: RULESET, farm, version, initials, score, code, date: new Date().toISOString() };
      await env.LB.put(`pending:${entry.id}`, JSON.stringify(entry));
      board.pending.push({ id: entry.id, initials, score, date: entry.date });
      await putBoard(env, farm, board);
      return json({ status: 'checking' });
    }

    // For the GitHub job only: everything waiting to be checked, with its code.
    if (request.method === 'GET' && url.pathname === '/pending') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      const out = [];
      for (const farm of FARMS) for (const p of (await getBoard(env, farm)).pending) {
        const entry = await env.LB.get(`pending:${p.id}`, 'json');
        if (entry) out.push(entry);
      }
      return json({ pending: out });
    }

    // For the GitHub job only: the score the code really earned. A match goes on the board.
    if (request.method === 'POST' && url.pathname === '/verify') {
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      const { id, score } = await request.json();
      const entry = await env.LB.get(`pending:${id}`, 'json');
      if (!entry) return json({ error: 'unknown-entry' }, 404);
      const board = await getBoard(env, entry.farm);
      board.pending = board.pending.filter(p => p.id !== id);
      const accepted = score === entry.score && (entry.version || 0) === versionOf(entry.farm);
      if (accepted && qualifies(board, entry.initials, entry.score)) {
        board.entries = rank([...board.entries.filter(e => e.initials !== entry.initials), { initials: entry.initials, score: entry.score, date: entry.date }]);
      }
      await putBoard(env, entry.farm, board);
      await env.LB.delete(`pending:${id}`);
      return json({ accepted });
    }

    return json({ error: 'not-found' }, 404);
  },
};
