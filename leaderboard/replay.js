// Replays a leaderboard submission with the game's own rules and interpreter, taken from
// index.html, so the score is exactly what the game would give. Used by verify.js and the tests.
const fs = require('fs');
const path = require('path');

function loadCore(file = path.join(__dirname, '..', 'index.html')) {
  const page = fs.readFileSync(file, 'utf8');
  const get = id => page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  return new Function(`${get('apl-interpreter')}\n${get('acres-core')}\nreturn AcresCore;`)();
}

// The score a submission's code earns on its farm, or -1 if it isn't a valid entry: broken code,
// an unknown farm, an experimental farm's earlier rules, or a season that takes longer than
// budgetMs to play, so one slow program can't hold up everyone else's scores.
function replay(core, entry, budgetMs = 10000) {
  const farm = core.FARMS.find(f => f.id === entry.farm);
  if (!farm || entry.ruleset !== core.RULES.id || (entry.version || 0) !== (farm.boardVersion || 0)) return -1;
  const start = Date.now();
  try {
    const p = core.compileProgram(entry.code);
    const st = core.newSeason(farm.seed, farm);
    while (st.day < core.RULES.days) {
      if (Date.now() - start > budgetMs) return -1;
      core.advance(st, core.runHarvest(p.harvest, st.field), farm.crows && p.scare ? core.runScare(p.scare, st.field) : null);
    }
    return st.score;
  } catch (e) {
    return -1;
  }
}

module.exports = { loadCore, replay };
