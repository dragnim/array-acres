// Replays a leaderboard submission with the game's own rules and interpreter, taken from
// index.html, so the score is exactly what the game would give. Used by verify.js and the tests.
const fs = require('fs');
const path = require('path');

function loadCore(file = path.join(__dirname, '..', 'index.html')) {
  const page = fs.readFileSync(file, 'utf8');
  const get = id => page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  return new Function(`${get('apl-interpreter')}\n${get('acres-core')}\nreturn AcresCore;`)();
}

// The score a submission's code earns on its farm, or -1 if it isn't a valid entry.
function replay(core, entry) {
  const farm = core.FARMS.find(f => f.id === entry.farm);
  if (!farm || farm.crows || entry.ruleset !== core.RULES.id) return -1;
  try {
    const fn = core.compileHarvest(entry.code);
    const st = core.newSeason(farm.seed, farm);
    while (st.day < core.RULES.days) core.advance(st, core.runHarvest(fn, st.field));
    return st.score;
  } catch (e) {
    return -1;
  }
}

module.exports = { loadCore, replay };
