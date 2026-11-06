// Leaderboard tests: the Worker against a real SQLite database standing in for D1, and the
// replay that checks scores.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { loadCore, replay } = require('../leaderboard/replay');

let failures = 0, checks = 0;
function check(name, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
}

// Just enough of D1's API (prepare, bind, first, all, run, batch) over SQLite.
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '..', 'leaderboard', 'schema.sql'), 'utf8'));
  const plain = o => o && { ...o };
  const stmt = (text, args = []) => ({
    text, args,
    bind: (...a) => stmt(text, a),
    first: async () => plain(sql.prepare(text).get(...args)) || null,
    all: async () => ({ results: sql.prepare(text).all(...args).map(plain) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(text).run(...args).changes) } }),
  });
  return {
    sql,
    prepare: text => stmt(text),
    batch: async list => {
      sql.exec('BEGIN');
      try { const out = list.map(s => sql.prepare(s.text).run(...s.args)); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

(async () => {
  const { default: worker, SIZE, MAX_PENDING, SUBMITS_PER_HOUR } = await import('../leaderboard/worker.mjs');
  let clock = Date.parse('2026-11-07T12:00:00Z');
  const env = { LEADERBOARD_TOKEN: 'test-token', DB: fakeD1(), now: () => clock };
  let ip = '192.0.2.1';
  const call = async (method, path, body, auth) => {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await worker.fetch(new Request(`https://lb.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, body: await res.json() };
  };
  const pending = async () => (await call('GET', '/pending', null, 'test-token')).body.pending;
  const verifyAll = async () => { for (const p of await pending()) await call('POST', '/verify', { id: p.id, score: replay(core, p) }, 'test-token'); };
  const board = async farm => (await call('GET', `/board?farm=${farm}`)).body;
  const core = loadCore();
  const GOLD = 'Harvest←{(⍵=Rotten)∨(BumperCrops ⍵)∨(⍵=Ripe)∧~Promising ⍵}', RIPE = 'Harvest←{⍵≥Ripe}';
  const SCARE = 'Around←{p←0⍪(0,⍵,0)⍪0 ⋄ (8 8↑p)+(8 8↑0 1↓p)+(8 8↑0 2↓p)+(8 8↑1 0↓p)+(8 8↑1 1↓p)+(8 8↑1 2↓p)+(8 8↑2 0↓p)+(8 8↑2 1↓p)+8 8↑2 2↓p}\n'
    + 'Top2←{8 8⍴(⍳64)∊2↑⍒,⍵}\n' + GOLD + '\nScare←{v←(⍵≥Growing)∧(⍵≤Ripe)∧Promising ⍵ ⋄ ok←(⍵=Seed)∨Harvest ⍵ ⋄ s←ok×Around v ⋄ (s>0)∧Top2 s}';

  // Replay: the score the game gives, and -1 for anything that isn't a valid entry.
  check('replay: the Gold strategy scores what the game gives', replay(core, { ruleset: 'v2', farm: 'middlebourne-farm', code: GOLD }), 1533);
  check('replay: broken code, unknown farms, old rulesets and old experiment versions are invalid',
    [replay(core, { ruleset: 'v2', farm: 'middlebourne-farm', code: 'Harvest←{⍵=}' }), replay(core, { ruleset: 'v2', farm: 'nowhere', code: GOLD }),
     replay(core, { ruleset: 'v2', farm: 'crowhurst-farm', version: 0, code: GOLD }), replay(core, { ruleset: 'v1', farm: 'middlebourne-farm', code: GOLD })], [-1, -1, -1, -1]);
  check('replay: Crowhurst replays Scare too, scoring what the game gives', replay(core, { ruleset: 'v2', farm: 'crowhurst-farm', version: 1, code: SCARE }), 1288);
  check('replay: a season slower than its time budget is invalid', replay(core, { ruleset: 'v2', farm: 'middlebourne-farm', code: GOLD }, 0), -1);

  // Submitting puts a score in "checking"; nothing reaches the board until it's verified.
  let r = await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'abc', score: 1533, code: GOLD });
  check('submit: a qualifying score waits to be checked', [r.status, r.body.status], [200, 'checking']);
  let b = await board('middlebourne-farm');
  check('board: the new score shows as checking, not on the board', [b.entries.length, b.pending.map(p => p.initials)], [0, ['ABC']]);
  check('board: pending entries never reveal code', 'code' in b.pending[0], false);

  // Only the GitHub job, with the token, sees pending code and verifies.
  check('pending: refused without the token', (await call('GET', '/pending')).status, 401);
  check('pending: refused with the wrong token', (await call('GET', '/pending', null, 'nope-token')).status, 401);
  check('pending: the job sees the code to replay', (await pending()).map(p => [p.initials, p.code, p.ruleset]), [['ABC', GOLD, 'v2']]);
  check('verify: a malformed request is refused', (await call('POST', '/verify', { id: 7 }, 'test-token')).status, 400);
  await verifyAll();
  b = await board('middlebourne-farm');
  check('verify: a score the code really earns goes on the board', [b.entries.map(e => [e.initials, e.score]), b.pending.length], [[['ABC', 1533]], 0]);

  // A faked score is rejected and never appears.
  await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'CHT', score: 9999, code: RIPE });
  await verifyAll();
  b = await board('middlebourne-farm');
  check('verify: a faked score is rejected and removed', [b.entries.map(e => e.initials), b.pending.length], [['ABC'], 0]);

  // One entry waiting per initials: a better score replaces it, a worse one is refused.
  await call('POST', '/submit', { farm: 'sunnyhill-farm', initials: 'DUP', score: 1465, code: RIPE });
  r = await call('POST', '/submit', { farm: 'sunnyhill-farm', initials: 'DUP', score: 1000, code: RIPE });
  check('submit: a worse score than your waiting one is refused', r.body.error, 'not-high-enough');
  await call('POST', '/submit', { farm: 'sunnyhill-farm', initials: 'DUP', score: 2132, code: GOLD });
  check('submit: a better score replaces your waiting one', (await pending()).map(p => [p.initials, p.score]), [['DUP', 2132]]);
  await verifyAll();

  // Simultaneous submissions and checks don't overwrite each other.
  await Promise.all(['SIA', 'SIB', 'SIC'].map((initials, i) => { ip = `198.51.100.${i}`; return call('POST', '/submit', { farm: 'marshgate-farm', initials, score: 1093, code: RIPE }); }));
  check('simultaneous: three submissions at once all wait to be checked', (await board('marshgate-farm')).pending.map(p => p.initials).sort(), ['SIA', 'SIB', 'SIC']);
  const three = await pending();
  await Promise.all(three.map(p => call('POST', '/verify', { id: p.id, score: replay(core, p) }, 'test-token')));
  check('simultaneous: three checks at once all reach the board', (await board('marshgate-farm')).entries.map(e => e.initials).sort(), ['SIA', 'SIB', 'SIC']);

  // A full board keeps its top 10; two scores competing for the last place are settled by score.
  ip = '203.0.113.9';
  const DB = env.DB.sql;
  for (let i = 0; i < SIZE; i++) DB.prepare('INSERT INTO entries VALUES (?, ?, ?, ?)').run('v2:sunnyhill-farm', `T${String.fromCharCode(65 + i)}X`, 1500 + i, '2026-11-01');
  DB.prepare('DELETE FROM entries WHERE board = ? AND initials = ?').run('v2:sunnyhill-farm', 'DUP');
  check('board: a full board needs more than its lowest score', (await call('POST', '/submit', { farm: 'sunnyhill-farm', initials: 'LOW', score: 1500, code: RIPE })).body.error, 'not-high-enough');
  DB.prepare('INSERT INTO pending VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'v2:sunnyhill-farm', 'sunnyhill-farm', 0, 'ONE', 2132, GOLD, new Date(clock).toISOString());
  DB.prepare('INSERT INTO pending VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p2', 'v2:sunnyhill-farm', 'sunnyhill-farm', 0, 'TWO', 1465, RIPE, new Date(clock).toISOString());
  await Promise.all([call('POST', '/verify', { id: 'p1', score: 2132 }, 'test-token'), call('POST', '/verify', { id: 'p2', score: 1465 }, 'test-token')]);
  b = await board('sunnyhill-farm');
  check('board: only the top 10 is shown, best first', [b.entries.length, b.entries[0].initials, b.entries.map(e => e.initials).includes('TAX')], [SIZE, 'ONE', false]);

  // Unchecked entries expire, so a stalled checker can't jam the queue for good.
  await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'OLD', score: 1213, code: RIPE });
  clock += 25 * 3600e3;
  check('expiry: an entry left unchecked for over a day disappears', [(await board('middlebourne-farm')).pending.length, (await pending()).length], [0, 0]);
  await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'NEW', score: 1213, code: RIPE });
  check('expiry: and is cleared out when the next score arrives', DB.prepare("SELECT COUNT(*) AS n FROM pending WHERE initials = 'OLD'").get().n, 0);
  await verifyAll();

  // The queue and the senders are limited.
  ip = '192.0.2.200';
  let last;
  for (let i = 0; i < SUBMITS_PER_HOUR + 1; i++) last = await call('POST', '/submit', { farm: 'middlebourne-farm', initials: `R${String.fromCharCode(65 + i)}A`, score: 1300 + i, code: RIPE });
  check('rate limit: one sender can only submit so often', [last.status, last.body.error], [429, 'rate-limited']);
  check('rate limit: senders are stored only as a hash', DB.prepare('SELECT sender FROM submissions LIMIT 1').get().sender.includes('192.0.2'), false);
  DB.exec('DELETE FROM pending; DELETE FROM submissions');
  for (let i = 0; i < MAX_PENDING; i++) DB.prepare('INSERT INTO pending VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`q${i}`, 'v2:middlebourne-farm', 'middlebourne-farm', 0, `Q${String.fromCharCode(65 + i)}A`, 1300, RIPE, new Date(clock).toISOString());
  ip = '192.0.2.201';
  check('queue: a full queue asks players to try again later', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'FUL', score: 1400, code: RIPE })).body.error, 'busy');
  DB.exec('DELETE FROM pending');

  // Arcade rules: three letters, nothing rude, a known farm, a new best for those initials.
  ip = '192.0.2.202';
  check('submit: initials must be three letters', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'AB1', score: 2000, code: GOLD })).body.error, 'initials');
  check('submit: rude initials are refused', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'wtf', score: 2000, code: GOLD })).body.error, 'initials-not-allowed');
  check('submit: an unknown farm is refused', (await call('POST', '/submit', { farm: 'nowhere', initials: 'ABC', score: 2000, code: GOLD })).body.error, 'unknown-farm');
  check('submit: no worse than your own best', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'ABC', score: 1500, code: GOLD })).body.error, 'not-high-enough');

  // Crowhurst's experimental board: versioned, and Scare is replayed.
  check('crowhurst: a score from an experiment\'s earlier rules is refused', (await call('POST', '/submit', { farm: 'crowhurst-farm', version: 0, initials: 'ABC', score: 1288, code: SCARE })).body.error, 'outdated');
  await call('POST', '/submit', { farm: 'crowhurst-farm', version: 1, initials: 'CRW', score: 1288, code: SCARE });
  await verifyAll();
  b = await board('crowhurst-farm');
  check('crowhurst: its versioned board takes verified scores', [b.version, b.entries.map(e => [e.initials, e.score])], [1, [['CRW', 1288]]]);
  check('crowhurst: scores are stored under the board\'s version', DB.prepare("SELECT board FROM entries WHERE initials = 'CRW'").get().board, 'v2:crowhurst-farm:1');

  console.log(failures ? `${failures} of ${checks} leaderboard checks failed` : `All ${checks} leaderboard checks passed`);
  process.exitCode = failures ? 1 : 0;
})();
