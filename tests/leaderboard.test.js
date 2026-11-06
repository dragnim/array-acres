// Leaderboard tests: the Worker's rules against an in-memory store, and the replay that checks scores.
const { loadCore, replay } = require('../leaderboard/replay');

let failures = 0, checks = 0;
function check(name, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
}

(async () => {
  const { default: worker, qualifies, SIZE } = await import('../leaderboard/worker.mjs');
  const store = new Map();
  const env = {
    LEADERBOARD_TOKEN: 'test-token',
    LB: {
      get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => { store.set(k, v); },
      delete: async k => { store.delete(k); },
    },
  };
  const call = async (method, path, body, auth) => {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await worker.fetch(new Request(`https://lb.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, body: await res.json() };
  };
  const core = loadCore();
  const GOLD = 'Harvest←{(⍵=Rotten)∨(BumperCrops ⍵)∨(⍵=Ripe)∧~Promising ⍵}';

  // Replay: the score the game gives, and -1 for anything that isn't a valid entry.
  check('replay: the Gold strategy scores what the game gives', replay(core, { ruleset: 'v2', farm: 'middlebourne-farm', code: GOLD }), 1533);
  check('replay: broken code, unknown farms, Crowhurst and old rulesets are invalid',
    [replay(core, { ruleset: 'v2', farm: 'middlebourne-farm', code: 'Harvest←{⍵=}' }), replay(core, { ruleset: 'v2', farm: 'nowhere', code: GOLD }),
     replay(core, { ruleset: 'v2', farm: 'crowhurst-farm', code: GOLD }), replay(core, { ruleset: 'v1', farm: 'middlebourne-farm', code: GOLD })], [-1, -1, -1, -1]);

  // Submitting puts a score in "checking"; nothing reaches the board until it's verified.
  let r = await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'abc', score: 1533, code: GOLD });
  check('submit: a qualifying score waits to be checked', [r.status, r.body.status], [200, 'checking']);
  r = await call('GET', '/board?farm=middlebourne-farm');
  check('board: the new score shows as checking, not on the board', [r.body.entries.length, r.body.pending.map(p => p.initials)], [0, ['ABC']]);
  check('board: pending entries never reveal code', 'code' in r.body.pending[0], false);

  // Only the GitHub job, with the token, sees pending code and verifies.
  check('pending: refused without the token', (await call('GET', '/pending')).status, 401);
  check('pending: refused with the wrong token', (await call('GET', '/pending', null, 'nope-token')).status, 401);
  const pending = (await call('GET', '/pending', null, 'test-token')).body.pending;
  check('pending: the job sees the code to replay', pending.map(p => [p.initials, p.code]), [['ABC', GOLD]]);
  r = await call('POST', '/verify', { id: pending[0].id, score: replay(core, pending[0]) }, 'test-token');
  check('verify: a score the code really earns is accepted', r.body.accepted, true);
  r = await call('GET', '/board?farm=middlebourne-farm');
  check('board: the verified score is on the board', [r.body.entries.map(e => [e.initials, e.score]), r.body.pending.length], [[['ABC', 1533]], 0]);

  // A faked score is rejected and never appears.
  await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'CHT', score: 9999, code: 'Harvest←{⍵≥Ripe}' });
  const fake = (await call('GET', '/pending', null, 'test-token')).body.pending[0];
  r = await call('POST', '/verify', { id: fake.id, score: replay(core, fake) }, 'test-token');
  r = await call('GET', '/board?farm=middlebourne-farm');
  check('verify: a faked score is rejected and removed', [r.body.entries.map(e => e.initials), r.body.pending.length], [['ABC'], 0]);

  // Arcade rules: three letters, nothing rude, a new best for those initials, top 10 only.
  check('submit: initials must be three letters', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'AB1', score: 2000, code: GOLD })).body.error, 'initials');
  check('submit: rude initials are refused', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'wtf', score: 2000, code: GOLD })).body.error, 'initials-not-allowed');
  check('submit: Crowhurst Farm has no board yet', (await call('POST', '/submit', { farm: 'crowhurst-farm', initials: 'ABC', score: 2000, code: GOLD })).body.error, 'unknown-farm');
  check('submit: no worse than your own best', (await call('POST', '/submit', { farm: 'middlebourne-farm', initials: 'ABC', score: 1500, code: GOLD })).body.error, 'not-high-enough');
  const full = { entries: Array.from({ length: SIZE }, (_, i) => ({ initials: `A${String.fromCharCode(65 + i)}A`, score: 1000 + i * 10, date: '2026-01-01' })), pending: [] };
  check('qualifies: a full board needs more than its lowest score', [qualifies(full, 'NEW', 1000), qualifies(full, 'NEW', 1001)], [false, true]);
  check('qualifies: a board with room takes anyone', qualifies({ entries: [], pending: [] }, 'NEW', 1), true);

  console.log(failures ? `${failures} of ${checks} leaderboard checks failed` : `All ${checks} leaderboard checks passed`);
  process.exitCode = failures ? 1 : 0;
})();
