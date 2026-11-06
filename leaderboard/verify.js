// The scheduled GitHub job: fetch every score waiting to be checked, replay its code, and
// report the score it really earns. The Worker only accepts entries whose scores match.
const { loadCore, replay } = require('./replay');

const URL = process.env.LEADERBOARD_URL, TOKEN = process.env.LEADERBOARD_TOKEN;

async function main() {
  if (!URL || !TOKEN) { console.log('LEADERBOARD_URL or LEADERBOARD_TOKEN is not set; nothing to do.'); return; }
  const auth = { authorization: `Bearer ${TOKEN}` };
  const res = await fetch(`${URL}/pending`, { headers: auth });
  if (!res.ok) throw new Error(`/pending answered ${res.status}`);
  const { pending } = await res.json();
  const core = loadCore();
  for (const entry of pending) {
    const score = replay(core, entry);
    const r = await fetch(`${URL}/verify`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, score }) });
    const { accepted } = await r.json();
    console.log(`${entry.farm} ${entry.initials}: claimed ${entry.score}, replayed ${score}, ${accepted ? 'accepted' : 'rejected'}`);
  }
  if (!pending.length) console.log('Nothing waiting.');
}

main().catch(e => { console.error(e); process.exit(1); });
