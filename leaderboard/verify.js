// The scheduled GitHub job: fetch every score waiting to be checked, replay its code, and
// report the score it really earns. The Worker only accepts entries whose scores match.
// One failure doesn't stop the rest; any failure makes the job fail, so it shows in Actions.
const { loadCore, replay } = require('./replay');

const URL = process.env.LEADERBOARD_URL, TOKEN = process.env.LEADERBOARD_TOKEN;

async function main() {
  if (!URL || !TOKEN) { console.log('LEADERBOARD_URL or LEADERBOARD_TOKEN is not set; nothing to do.'); return; }
  const auth = { authorization: `Bearer ${TOKEN}` };
  const res = await fetch(`${URL}/pending`, { headers: auth });
  if (!res.ok) throw new Error(`/pending answered ${res.status}`);
  const { pending } = await res.json();
  const core = loadCore();
  let failures = 0;
  for (const entry of pending) {
    try {
      const score = replay(core, entry);
      const r = await fetch(`${URL}/verify`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, score }) });
      if (!r.ok) throw new Error(`/verify answered ${r.status}`);
      const { accepted } = await r.json();
      console.log(`${entry.farm} ${entry.initials}: claimed ${entry.score}, replayed ${score}, ${accepted ? 'accepted' : 'rejected'}`);
    } catch (e) {
      failures++;
      console.error(`${entry.farm} ${entry.initials}: could not be checked (${e.message}); it stays waiting for the next run.`);
    }
  }
  if (!pending.length) console.log('Nothing waiting.');
  if (failures) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
