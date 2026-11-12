// Array Acres core regression tests. No dependencies: run with `node tests/core.test.js`.
// Loads the interpreter and game core straight from the page, so the tests always exercise the real code.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const [pagePath = path.join(root, 'index.html'), refPath = path.join(root, 'reference', 'hybrid.apl')] = process.argv.slice(2);
const page = fs.readFileSync(pagePath, 'utf8');

// Find a script by id, so adding or reordering other scripts can't break the tests.
function scriptById(id) {
  const m = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  if (!m) { console.error(`Missing <script id="${id}"> in ${pagePath}`); process.exit(2); }
  return m[1];
}
const aplSrc = scriptById('apl-interpreter'), coreSrc = scriptById('acres-core');
const { APL, AcresCore } = new Function(aplSrc + '\n' + coreSrc + '\nreturn { APL, AcresCore };')();
const { RULES } = AcresCore;
const HYBRID = fs.readFileSync(refPath, 'utf8');
const GREEDY = 'Harvest←{⍵≥3}';

let checks = 0, failures = 0;
const check = (label, got, want) => {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
};

// 1. Interpreter: expressions with known Dyalog results
const ev = s => { try { return APL.format(APL.run(s).last); } catch (e) { return 'ERR ' + e.message; } };
const exprs = [
  ['1+2×3', '7'], ['-2×3', '¯6'], ['⍳5', '1 2 3 4 5'], ['+/⍳10', '55'], ['2 3⍴⍳6', '1 2 3\n4 5 6'],
  ['+/2 3⍴⍳6', '6 15'], ['+⌿2 3⍴⍳6', '5 7 9'], ['+\\⍳4', '1 3 6 10'], ['1 0 1/1 2 3', '1 3'], ['m←2 3⍴⍳6⋄m[2;3]', '6'],
  ['m←2 3⍴⍳6⋄m[;2]', '2 5'], ['⌽⍳4', '4 3 2 1'], ['1⌽⍳4', '2 3 4 1'], ['⍉2 3⍴⍳6', '1 4\n2 5\n3 6'], ['2↑⍳5', '1 2'], ['¯2↑⍳5', '4 5'], ['2↓⍳5', '3 4 5'],
  ['1 1↓3 3⍴⍳9', '5 6\n8 9'], ['¯1⊖3 3⍴⍳9', '7 8 9\n1 2 3\n4 5 6'], ['(⍳3)∘.×⍳3', '1 2 3\n2 4 6\n3 6 9'], ['(2 2⍴1 2 3 4)+.×2 2⍴5 6 7 8', '19 22\n43 50'],
  ['f←{⍵=3}⋄f 1 3 3', '0 1 1'], ['f←{⍺+⍵}⋄2 f 3', '5'], ['f←{⍺←10⋄⍺+⍵}⋄f 3', '13'], ['f←{⍵≤1:⍵⋄(∇⍵-1)+∇⍵-2}⋄f 10', '55'],
  ['(+/÷≢)1 2 3 4', '2.5'], ['3 4 5⍳4', '2'], ['⍵/⍨1', 'ERR VALUE ERROR: undefined name ⍵'], ['x←1 2 3⋄x/⍨1 0 1', '1 3'], ['{⍵×2}¨⍳3', '2 4 6'],
  ['1 2+1 2 3', 'ERR LENGTH ERROR: can\'t pair a vector of length 2 with a vector of length 3'], ['⌺', 'ERR NONCE ERROR: ⌺ isn\'t available yet'],
  ['(2 2⍴⍳4),9', '1 2 9\n3 4 9'], ['(2 2⍴⍳4)⍪9', '1 2\n3 4\n9 9'], ['⍸1 0 1', '1 3'], ['⍋3 1 2', '2 3 1'], ['1∘+ 5', '6'], ['-∘⌽ 1 2', '¯2 ¯1'], ['×/⍳0', '1'],
  ['3|¯1', '2'], ['~1 0', '0 1'], ['1 2 3~2', '1 3'], ['2 3∊1 2', '1 0'], ['0 1⌽2 2⍴⍳4', '1 2\n4 3'], ['⌈/3 9 2', '9'], ['{⍵}', '(function)'], ['5÷0', 'ERR DOMAIN ERROR: divide by zero'],
  ['2 2⍴¯1.5', '¯1.5 ¯1.5\n¯1.5 ¯1.5'], ['1 ¯1 2/4 5 6', '4 0 6 6'], ['≢2 3⍴0', '2'], ['+/,2 2⍴1', '4'],
];
for (const [src, want] of exprs) check(src, ev(src), want);

// 2. Seasons: same rules and seeds as the original simulations
const SEEDS = [...Array(200)].map((_, k) => (k + 1) * 7919);
function season(src, seed, previewSrc, weather) {
  const fn = AcresCore.compileHarvest(src), st = AcresCore.newSeason(seed, weather);
  while (st.day < RULES.days) {
    if (previewSrc) AcresCore.evaluate(previewSrc, st.field);
    AcresCore.advance(st, AcresCore.runHarvest(fn, st.field));
  }
  return st.score;
}
const total = (src, previewSrc) => SEEDS.reduce((s, x) => s + season(src, x, previewSrc), 0);
check('greedy {⍵≥3} total over 200 seasons', total(GREEDY), 243267);
check('hybrid reference total over 200 seasons', total(HYBRID), 307061);

// 3. Preview
const grid = rows => rows.map(r => [...r].map(Number));
const snapshot = st => JSON.stringify({ day: st.day, score: st.score, wasted: st.wasted, field: st.field, marks: st.marks, history: st.history });

const sample = grid(['33000003', '33000000', '00000000', '00000004', '00000000', '22000000', '32000033', '00000033']);
check('preview: valid Harvest returns the expected mask', AcresCore.evaluate(GREEDY, sample),
  { ok: true, mask: grid(['11000001', '11000000', '00000000', '00000001', '00000000', '00000000', '10000011', '00000011']) });

{
  const r = AcresCore.evaluate('Harvest←{⍵=}', sample);
  check('preview: invalid code is reported as a code error', [r.ok, r.kind], [false, 'code']);
}
// evaluate() must be read-only on every path, including Harvest functions that try to be clever.
for (const [label, src] of [
  ['successful evaluation', HYBRID],
  ['invalid APL', 'Harvest←{⍵=}'],
  ['invalid result', 'Harvest←{+/⍵}'],
  ['a Harvest that reassigns its argument', 'Harvest←{x←⍵ ⋄ ⍵≥3}'],
]) {
  const field = AcresCore.newSeason(SEEDS[3]).field, before = JSON.stringify(field);
  AcresCore.evaluate(src, field);
  check(`preview: input field unchanged after ${label}`, JSON.stringify(field), before);
}
{
  const r1 = AcresCore.evaluate('Harvest←{+/⍵}', sample), r2 = AcresCore.evaluate('Harvest←{⍵}', sample);
  check('preview: wrong shape is reported as a result error', [r1.ok, r1.kind, r1.message],
    [false, 'result', 'Harvest returned a vector of length 8, but it must return an 8×8 matrix']);
  check('preview: non-boolean mask is reported as a result error', [r2.ok, r2.kind, r2.message],
    [false, 'result', 'Harvest must return only 0s and 1s']);
}
{
  const st = AcresCore.newSeason(SEEDS[1]);
  for (let d = 0; d < 10; d++) AcresCore.advance(st, AcresCore.runHarvest(AcresCore.compileHarvest(GREEDY), st.field));
  const before = snapshot(st);
  for (const src of [GREEDY, HYBRID, 'Harvest←{⍵=}', 'Harvest←{+/⍵}']) AcresCore.evaluate(src, st.field);
  check('preview: does not change day, score, wasted, field or marks', snapshot(st), before);
}
{
  const a = AcresCore.newSeason(SEEDS[2]), b = AcresCore.newSeason(SEEDS[2]);
  for (let i = 0; i < 5; i++) AcresCore.evaluate(HYBRID, a.field);
  check('preview: does not consume simulation randomness', [a.rng(), a.rng()], [b.rng(), b.rng()]);
}
check('preview: running the hybrid preview every day leaves greedy totals unchanged', total(GREEDY, HYBRID), 243267);

// 4. Fixed fields for the hybrid reference, covering corners, edges, overlapping and potential blocks
const fixed = [
  ['ripe blocks in two corners, a lone corner plot, a waiting corner plot, rot on an edge',
    ['33000003', '33000000', '00000000', '00000004', '00000000', '22000000', '32000033', '00000033'],
    ['11000001', '11000000', '00000000', '00000001', '00000000', '00000000', '00000011', '00000011']],
  ['overlapping blocks, a lone plot beside sprouts, a plot waiting on growing neighbours',
    ['00000000', '03330000', '03330000', '00000000', '31000000', '11000322', '00000220', '00000000'],
    ['00000000', '01110000', '01110000', '00000000', '10000000', '00000000', '00000000', '00000000']],
  ['a block one sprout short, and four corners that only form a block if the field wrapped',
    ['30000003', '00000000', '00033000', '00031000', '00000000', '00000000', '00000000', '30000003'],
    ['10000001', '00000000', '00011000', '00010000', '00000000', '00000000', '00000000', '10000001']],
];
for (const [label, field, want] of fixed) check(`hybrid mask: ${label}`, AcresCore.evaluate(HYBRID, grid(field)), { ok: true, mask: grid(want) });

// 5. Daily statistics: observations of the rules, checked against totals and an independent count of rot.
{
  check('stats: a new season starts with no history', AcresCore.newSeason(SEEDS[0]).history, []);
  const sum = (h, k) => h.reduce((s, d) => s + d[k], 0);
  let ok = true, detail = '';
  for (const [name, src] of [['greedy', GREEDY], ['hybrid', HYBRID]]) {
    const fn = AcresCore.compileHarvest(src);
    for (const seed of SEEDS.slice(0, 20)) {
      const st = AcresCore.newSeason(seed);
      while (st.day < RULES.days) {
        const mask = AcresCore.runHarvest(fn, st.field), before = st.field.map(r => r.slice());
        AcresCore.advance(st, mask);
        // Rot counted from the fields themselves: ripe, not harvested, and rotten afterwards.
        let rotted = 0;
        for (let r = 0; r < RULES.size; r++) for (let c = 0; c < RULES.size; c++)
          if (before[r][c] === RULES.ripe && !mask[r][c] && st.field[r][c] === RULES.rot) rotted++;
        const d = st.history[st.history.length - 1];
        if (d.day !== st.day || d.rotted !== rotted || d.cumulative !== st.score
          || d.points !== d.ripeHarvested + (RULES.bonus - 1) * d.bonusPlots || d.bonusPlots > d.ripeHarvested) {
          ok = false; detail = `${name} seed ${seed} day ${st.day}: ${JSON.stringify(d)}, rot counted ${rotted}`;
        }
      }
      if (st.history.length !== RULES.days || sum(st.history, 'points') !== st.score || sum(st.history, 'wasted') !== st.wasted) {
        ok = false; detail = `${name} seed ${seed}: history doesn't add up to the season totals`;
      }
    }
  }
  check('stats: daily records match the season over 40 seasons' + (detail ? ` (${detail})` : ''), ok, true);
}

// 6. Rulesets, farms and personal bests
{
  const FARMS = AcresCore.FARMS, PRACTICE = AcresCore.PRACTICE;
  // Crowhurst Farm adds crows and Blightwick Farm adds blight; their own checks are in sections 12 and 13.
  // Tutorial Farm is smaller and shorter; its own checks are in section 15.
  const PLAIN = FARMS.filter(f => !f.crows && !f.blight && !f.tutorial);
  check('rules: the ruleset is v2 and cannot be changed', [RULES.id, Object.isFrozen(RULES)], ['v2', true]);
  const ids = FARMS.map(f => f.id);
  check('farms: six farms with unique ids, all on rules v2 and fixed',
    [ids.length, new Set(ids).size, FARMS.every(f => f.rules === RULES.id && Object.isFrozen(f))], [6, 6, true]);
  check('farms: each farm without crows has its own weather', new Set(PLAIN.map(f => `${f.sunshine}/${f.rainfall}`)).size, 3);
  check('farms: Practice Farm has Middlebourne Farm’s weather', [PRACTICE.sunshine, PRACTICE.rainfall], [FARMS[0].sunshine, FARMS[0].rainfall]);
  const onFarm = (src, f) => season(src, f.seed, null, f);
  // Pinned results: if these move, the farms have changed and old personal bests no longer compare.
  const pinned = { 'middlebourne-farm': [1213, 1533], 'sunnyhill-farm': [1465, 2132], 'marshgate-farm': [1093, 1238] };
  for (const f of PLAIN)
    check(`farm ${f.id}: greedy and hybrid scores`, [onFarm(GREEDY, f), onFarm(HYBRID, f)], pinned[f.id]);

  // Targets: a ladder of strategies must land in the intended tiers on every farm.
  const BLOCKS = `Blocks←{
    tl←⍵∧((⍴⍵)↑0 1↓⍵)∧((⍴⍵)↑1 0↓⍵)∧(⍴⍵)↑1 1↓⍵
    tl∨((-⍴⍵)↑0 ¯1↓tl)∨((-⍴⍵)↑¯1 0↓tl)∨(-⍴⍵)↑¯1 ¯1↓tl
  }`;
  const BLOCKS_ONLY = `Harvest←{\n  ${BLOCKS}\n  (⍵=4)∨Blocks ⍵=3\n}`;
  const WRAPPED = `Harvest←{
  Blocks←{
    tl←⍵∧(1⌽⍵)∧(1⊖⍵)∧1⊖1⌽⍵
    tl∨(¯1⌽tl)∨(¯1⊖tl)∨¯1⊖¯1⌽tl
  }
  ripe←⍵=3
  (⍵=4)∨(Blocks ripe)∨ripe∧~Blocks ⍵∊2 3
}`;
  // Waiting only for bumper crops pays off in Sunnyhill Farm's sunshine, but not on the other farms.
  const blocksOnly = { 'middlebourne-farm': null, 'sunnyhill-farm': 'silver', 'marshgate-farm': null };
  for (const f of PLAIN) {
    const t = f.targets, tier = src => AcresCore.tierFor(f, onFarm(src, f));
    check(`targets ${f.id}: fixed and rising`, [Object.isFrozen(t), t.bronze < t.silver && t.silver < t.gold], [true, true]);
    check(`targets ${f.id}: ripe-only, blocks-only, wrap-around and hybrid land in their tiers`,
      [tier('Harvest←{⍵=3}'), tier(BLOCKS_ONLY), tier(WRAPPED), tier(HYBRID)], ['bronze', blocksOnly[f.id], 'silver', 'gold']);
  }
  const mf = FARMS[0];
  check('targets: a score exactly on a target reaches it',
    [AcresCore.tierFor(mf, mf.targets.bronze - 1), AcresCore.tierFor(mf, mf.targets.bronze), AcresCore.tierFor(mf, mf.targets.gold)], [null, 'bronze', 'gold']);

  const e = (farm, score, ruleset = 'v2') => ({ ruleset, farm, seed: 1, score });
  let r = AcresCore.recordBest({}, e('middlebourne-farm', 1200));
  check('bests: a first result is recorded', [r.improved, r.previous, r.bests['v2:middlebourne-farm'].score], [true, null, 1200]);
  const after = AcresCore.recordBest(r.bests, e('middlebourne-farm', 1300));
  check('bests: a higher score replaces the best', [after.improved, after.previous.score, after.bests['v2:middlebourne-farm'].score], [true, 1200, 1300]);
  const lower = AcresCore.recordBest(after.bests, e('middlebourne-farm', 1250)), equal = AcresCore.recordBest(after.bests, e('middlebourne-farm', 1300));
  check('bests: a lower or equal score leaves the best alone', [lower.improved, lower.bests === after.bests, equal.improved, equal.bests === after.bests], [false, true, false, true]);
  const other = AcresCore.recordBest(after.bests, e('sunnyhill-farm', 900)), v3 = AcresCore.recordBest(after.bests, e('middlebourne-farm', 100, 'v3'));
  check('bests: kept separately per farm and per ruleset',
    [other.improved, other.bests['v2:middlebourne-farm'].score, v3.improved, v3.bests['v2:middlebourne-farm'].score], [true, 1300, true, 1300]);
}

// 7. Bumper crops: ripe 2×2 squares for drawing, overlapping squares included
check('bumper crops: overlapping squares are all found',
  AcresCore.ripeSquares(grid(['00000000', '03330000', '03330000', '00000000', '31000000', '11000322', '00000220', '00000000'])), [[1, 1], [1, 2]]);
check('bumper crops: squares in corners are found, and corners never join across edges',
  AcresCore.ripeSquares(grid(['33000003', '33000000', '00000000', '00000000', '00000000', '00000000', '30000033', '00000033'])), [[0, 0], [6, 6]]);
check('bumper crops: a square with a rotten or growing plant is not a bumper crop',
  AcresCore.ripeSquares(grid(['34000000', '33000000', '00000000', '00032000', '00033000', '00000000', '00000000', '00000000'])), []);

// 8. The rules as written on the page: every claim checked against the simulation
{
  const N = RULES.size, ripe = RULES.ripe, rot = RULES.rot;
  let starts = true, steps = true, waste = true, rates = true;
  for (const f of AcresCore.FARMS.filter(f => !f.crows && !f.blight && !f.tutorial)) {
  let grew = 0, couldGrow = 0, rotted = 0, couldRot = 0;
  for (const src of [GREEDY, HYBRID, 'Harvest←{0}']) {
    const fn = AcresCore.compileHarvest(src);
    for (const seed of SEEDS.slice(0, 15)) {
      const st = AcresCore.newSeason(seed, f);
      if (!st.field.flat().every(v => v >= 0 && v <= 3)) starts = false;
      while (st.day < RULES.days) {
        const mask = AcresCore.runHarvest(fn, st.field), before = st.field.map(r => r.slice());
        AcresCore.advance(st, mask);
        let wasted = 0;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const b = before[r][c], a = st.field[r][c];
          if (mask[r][c]) {
            if (b === 1 || b === 2) wasted++;
            if (a !== 0 && a !== 1) steps = false;    // replanted as a seed, which may grow that night
            couldGrow++; if (a === 1) grew++;
          } else if (b < ripe) {
            if (a !== b && a !== b + 1) steps = false;
            couldGrow++; if (a === b + 1) grew++;
          } else if (b === ripe) {
            if (a !== ripe && a !== rot) steps = false;
            couldRot++; if (a === rot) rotted++;
          } else if (a !== rot) steps = false;       // rotten stays until harvested
        }
        if (st.history[st.history.length - 1].wasted !== wasted) waste = false;
      }
    }
  }
  // Each farm's stated sunshine and rainfall should be what actually happens, to within sampling error.
  if (Math.abs(grew / couldGrow - f.sunshine) > 0.01 || Math.abs(rotted / couldRot - f.rainfall) > 0.015) rates = false;
  }
  check('rules: a season starts with every plot at stage 0 to 3', starts, true);
  check('rules: no plot changes by more than one stage a night, and rot only comes from unharvested ripe plants', steps, true);
  check('rules: only harvested sprouts and growing plants count as wasted', waste, true);
  check('rules: each farm’s growth and rot match its sunshine and rainfall', rates, true);
}

// 9. Progression: medals unlock symbols, helpers and farms
{
  const F = Object.fromEntries(AcresCore.FARMS.map(f => [f.id, f]));
  const play = (src, f, access) => {
    const fn = AcresCore.compileHarvest(src, access), st = AcresCore.newSeason(f.seed, f);
    while (st.day < RULES.days) AcresCore.advance(st, AcresCore.runHarvest(fn, st.field));
    return st.score;
  };
  const msg = (src, access) => {
    try { AcresCore.runHarvest(AcresCore.compileHarvest(src, access), AcresCore.newSeason(1).field); return 'ok'; }
    catch (e) { return e.message; }
  };
  const p0 = AcresCore.progress({});
  check('progress: a new player has Tutorial Farm, Middlebourne Farm and the comparisons only',
    [p0.earned, [...p0.glyphs].join(''), [...p0.helpers], [...p0.farms], p0.source], [['start'], '=≠<>≤≥', [], ['tutorial-farm', 'middlebourne-farm'], false]);
  check('locks: a locked symbol says what unlocks it', msg('Harvest←{(⍵=3)∨⍵=4}', p0), 'LOCKED: ∨ unlocks with Bronze on Middlebourne Farm');
  check('locks: a locked helper says what unlocks it', msg('Harvest←{BumperCrops ⍵}', p0), 'LOCKED: BumperCrops unlocks with Bronze on Middlebourne Farm');
  check('locks: symbols in comments don’t count', msg('⍝ try ∨ later\nHarvest←{⍵=3}', p0), 'ok');
  check('locks: players can still define their own names', msg('BumperCrops←{⍵=3}\nHarvest←{BumperCrops ⍵}', p0), 'ok');

  // The intended journey, step by step.
  const s1 = play('Harvest←{⍵=3}', F['middlebourne-farm'], p0);
  check('journey: harvesting ripe plants on Middlebourne Farm reaches Bronze', [s1, AcresCore.tierFor(F['middlebourne-farm'], s1)], [1213, 'bronze']);
  const p1 = AcresCore.progress({ 'v2:middlebourne-farm': { score: s1 } });
  check('journey: Bronze on Middlebourne Farm unlocks ∧ ∨ ~, BumperCrops and Sunnyhill Farm',
    [p1.earned, [...p1.glyphs].includes('∨'), [...p1.helpers], [...p1.farms]], [['start', 'middlebourne-bronze'], true, ['BumperCrops'], ['tutorial-farm', 'middlebourne-farm', 'sunnyhill-farm']]);
  const s2 = play('Harvest←{(⍵=4)∨BumperCrops ⍵}', F['sunnyhill-farm'], p1);
  check('journey: harvesting only bumper crops on Sunnyhill Farm reaches Silver', [s2, AcresCore.tierFor(F['sunnyhill-farm'], s2)], [1995, 'silver']);
  const p2 = AcresCore.progress({ 'v2:middlebourne-farm': { score: s1 }, 'v2:sunnyhill-farm': { score: s2 } });
  check('journey: Silver on Sunnyhill Farm unlocks Promising and Marshgate Farm',
    [p2.earned.includes('sunnyhill-silver'), [...p2.helpers], p2.farms.has('marshgate-farm')], [true, ['BumperCrops', 'Promising'], true]);
  const smart = 'Harvest←{(⍵=4)∨(BumperCrops ⍵)∨(⍵=3)∧~Promising ⍵}';
  check('journey: the helpers reproduce the reference strategy and reach Gold on every farm',
    AcresCore.FARMS.filter(f => !f.crows && !f.blight && !f.tutorial).map(f => { const sc = play(smart, f, p2); return [sc, AcresCore.tierFor(f, sc)]; }), [[1533, 'gold'], [2132, 'gold'], [1238, 'gold']]);
  const p3 = AcresCore.progress({ 'v2:marshgate-farm': { score: 1200 } });
  check('journey: Gold on any farm unlocks every symbol and the helpers’ source',
    [p3.earned.includes('any-gold'), p3.glyphs.has('↑'), p3.helpers.has('Squares'), p3.source], [true, true, true, true]);

  const day1 = AcresCore.newSeason(F['middlebourne-farm'].seed, F['middlebourne-farm']).field;
  check('names: the stage names work from the start and mean their numbers',
    [msg('Harvest←{⍵≥Growing}', p0),
     JSON.stringify(AcresCore.evaluate('Harvest←{⍵=Ripe}', day1, p0).mask) === JSON.stringify(AcresCore.evaluate('Harvest←{⍵=3}', day1, p0).mask)], ['ok', true]);
  check('names: a name that differs only in capitals gets a suggestion',
    [msg('Harvest←{⍵=ripe}', p0), msg('Harvest←{⍵=ROTTEN}', p0), msg('Harvest←{⍵=Rip}', p0)],
    ['VALUE ERROR: undefined name ripe. Did you mean Ripe? APL names are case-sensitive.', 'VALUE ERROR: undefined name ROTTEN. Did you mean Rotten? APL names are case-sensitive.', 'VALUE ERROR: undefined name Rip']);
  check('names: players can still use a stage name for their own value', msg('Ripe←4\nHarvest←{⍵=Ripe}', p0), 'ok');
  check('helpers: BumperCrops marks exactly the plants in ripe 2×2 squares',
    AcresCore.evaluate('Harvest←BumperCrops', grid(['33000003', '33000000', '00000000', '00000000', '00000000', '00000000', '30000033', '00000033'])).mask,
    grid(['11000000', '11000000', '00000000', '00000000', '00000000', '00000000', '00000011', '00000011']));
  check('helpers: Promising marks every 2×2 square of growing or ripe plants',
    AcresCore.evaluate('Harvest←Promising', grid(['23000000', '32000000', '00000000', '00012000', '00031000', '00000000', '00000000', '00000000'])).mask,
    grid(['11000000', '11000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000']));
}

// 10. Allocation limit: 1,000,000 elements is allowed, anything bigger is WS FULL, checked before allocating.
const WS = 'ERR WS FULL: array exceeds 1,000,000 elements';
const limits = [
  ['≢⍳1000000', '1000000'], ['⍳1000001', WS], ['⍳1e300', WS],
  ['≢,1000 1000⍴0', '1000000'], ['1000 1001⍴0', WS], ['1e20 1e20⍴0', WS],
  ['≢,1e20 0⍴0', '0'], ['≢,0 1e300⍴7', '0'],
  ['≢1000000/1', '1000000'], ['1000001/1', WS], ['≢2/⍳500000', '1000000'], ['2/⍳500001', WS],
  ['≢(⍳500000),⍳500000', '1000000'], ['(⍳500000),⍳500001', WS],
  ['≢1000000↑0', '1000000'], ['1000001↑0', WS],
  ['≢⍸,1000000', '1000000'], ['⍸,1000001', WS],
  ['≢,(⍳1000)∘.+⍳1000', '1000000'], ['(⍳1000)∘.+⍳1001', WS],
  ['m←1000 1000⍴0 ⋄ v←⍳1000 ⋄ ≢,m[v;v]', '1000000'], ['m←1000 1000⍴0 ⋄ v←⍳1000 ⋄ m[v;v,1]', WS],
  ['(1000 1⍴1)+.×1 1001⍴1', WS],
  // Oversized intermediates fail even when the final result is small.
  ['+/,1000 1001⍴1', WS], ['≢{⍵,⍵}⍳600000', WS], ['f←{+/,⍵∘.×⍵} ⋄ f ⍳1001', WS],
];
for (const [src, want] of limits) check(`limit: ${src}`, ev(src), want);

// 11. Work limit: primitives whose cost grows faster than their result stop quickly with
// INTERRUPT, instead of freezing the page, while ordinary sizes still work.
{
  const INT = 'ERR INTERRUPT: your function ran for too long';
  for (const src of ['+\\⍳1000000', '(1000 1000⍴1)+.×1000 1000⍴1', '(⍳1000000)∊⍳1000000', '(⍳1000000)⍳⍳1000000',
                     'f←{⍺=0:⍵ ⋄ (⍺-1) ∇ ⍵+1} ⋄ ≢100000 f ⍳1000000']) {
    const t = Date.now(), got = ev(src);
    check(`work: ${src} is interrupted`, got, INT);
    check(`work: ${src} stops within 3 seconds`, Date.now() - t < 3000, true);
  }
  check('work: a scan of 3000 items still runs', ev('⊃⌽+\\⍳3000'), '4501500');
  check('work: a 100×100 matrix product still runs', ev('⊃,(100 100⍴1)+.×100 100⍴1'), '100');
  check('work: the limit resets for each run', ev('≢,(⍳1000)∘.+⍳1000'), '1000000');
}

// 12. Crowhurst Farm: crows eat ripe plants left standing at night, except near scarecrows
{
  const crow = AcresCore.FARMS.find(f => f.crows), N = RULES.size;
  const AROUND = 'Around←{p←0⍪(0,⍵,0)⍪0 ⋄ (8 8↑p)+(8 8↑0 1↓p)+(8 8↑0 2↓p)+(8 8↑1 0↓p)+(8 8↑1 1↓p)+(8 8↑1 2↓p)+(8 8↑2 0↓p)+(8 8↑2 1↓p)+8 8↑2 2↓p}\n';
  const TOP2 = 'Top2←{8 8⍴(⍳64)∊2↑⍒,⍵}\n';
  const SMART = 'Harvest←{(⍵=Rotten)∨(BumperCrops ⍵)∨(⍵=Ripe)∧~Promising ⍵}';
  // Scarecrows on the plants they mean to protect trample them; scarecrows on seeds, or on plots
  // harvested today anyway, cost nothing.
  const NAIVE_SCARE = AROUND + TOP2 + SMART + '\nScare←{Top2 Around (⍵≥Growing)∧(⍵≤Ripe)∧Promising ⍵}';
  const SMART_SCARE = AROUND + TOP2 + SMART + '\nScare←{v←(⍵≥Growing)∧(⍵≤Ripe)∧Promising ⍵ ⋄ ok←(⍵=Seed)∨Harvest ⍵ ⋄ s←ok×Around v ⋄ (s>0)∧Top2 s}';
  const play = src => {
    const p = AcresCore.compileProgram(src), st = AcresCore.newSeason(crow.seed, crow);
    while (st.day < RULES.days) AcresCore.advance(st, AcresCore.runHarvest(p.harvest, st.field), p.scare ? AcresCore.runScare(p.scare, st.field) : null);
    return st.score;
  };
  check('crows: one flock a night, on Middlebourne Farm’s weather', [crow.crows, crow.sunshine, crow.rainfall], [1, AcresCore.FARMS[0].sunshine, AcresCore.FARMS[0].rainfall]);
  check('crows: pinned scores for ripe-only, hybrid, scarecrows on the plants, and scarecrows beside them',
    [play('Harvest←{⍵≥Ripe}'), play(SMART), play(NAIVE_SCARE), play(SMART_SCARE)], [1068, 1199, 928, 1288]);
  check('crows: ripe-only reaches Bronze, hybrid Silver, trampling the crop earns nothing, and scarecrows beside it Gold',
    ['Harvest←{⍵≥Ripe}', SMART, NAIVE_SCARE, SMART_SCARE].map(src => AcresCore.tierFor(crow, play(src))), ['bronze', 'silver', null, 'gold']);

  // A controlled night: nothing grows or rots, and the flock lands on row 2, column 3.
  const night = (scare) => {
    const st = AcresCore.newSeason(1, crow);
    st.field = grid(['00000000', '00333000', '00333000', '00333000', '00000000', '00000000', '00000000', '00000000']);
    const rolls = [...Array(N * N).fill(0.99), 2.5 / 8, 3.5 / 8]; let i = 0; st.rng = () => rolls[i++];
    AcresCore.advance(st, grid(Array(N).fill('00000000')), scare ? grid(scare) : null);
    return [st.eaten, st.crowPatches, st.field.flat().filter(v => v === RULES.ripe).length, st.history[0].trampled];
  };
  check('crows: a flock eats every ripe plant in its 3×3 patch, leaving seeds', night(null), [9, [[2, 3]], 0, 0]);
  check('crows: a scarecrow on a seed protects every plot within one step of it, at no cost',
    night(['00000000', '00000000', '00000000', '00000000', '00010000', '00000000', '00000000', '00000000']), [6, [[2, 3]], 3, 0]);
  check('crows: a scarecrow two steps away protects nothing',
    night(['00000000', '00000000', '00000000', '00000000', '00000000', '00010000', '00000000', '00000000']), [9, [[2, 3]], 0, 0]);
  check('crows: a scarecrow on a ripe plant tramples it back to a seed, but protects the eight around it',
    night(['00000000', '00000000', '00010000', '00000000', '00000000', '00000000', '00000000', '00000000']), [0, [[2, 3]], 8, 1]);
  // The flock lands where the next two rolls say: row ⌊8×a⌋, column ⌊8×b⌋.
  const nightAt = (field, a, b, scare = null, mask = null) => {
    const st = AcresCore.newSeason(1, crow);
    st.field = grid(field);
    const rolls = [...Array(N * N).fill(0.99), a, b]; let i = 0; st.rng = () => rolls[i++];
    AcresCore.advance(st, mask ? grid(mask) : grid(Array(N).fill('00000000')), scare ? grid(scare) : null);
    return { eaten: st.eaten, trampled: st.history[0].trampled, field: st.field.map(r => r.join('')) };
  };
  const RIPE_ALL = Array(N).fill('33333333'), NONE = Array(N).fill('00000000');
  check('crows: a flock landing in a corner reaches only the 4 plots inside the field', nightAt(RIPE_ALL, 0.01, 0.01).eaten, 4);
  check('crows: a flock landing on an edge reaches only 6 plots', nightAt(RIPE_ALL, 0.01, 0.5).eaten, 6);
  check('crows: two scarecrows with overlapping guards protect their combined area',
    nightAt(['00000000', '03330000', '00000000', '03330000', '00000000', '00000000', '00000000', '00000000'], 2.5 / 8, 2.5 / 8,
      ['00000000', '00000000', '01010000', '00000000', '00000000', '00000000', '00000000', '00000000']).eaten, 0);
  check('crows: a scarecrow on a plot harvested today costs nothing',
    nightAt(['00000000', '00333000', '00333000', '00333000', '00000000', '00000000', '00000000', '00000000'], 2.5 / 8, 3.5 / 8,
      ['00000000', '00000000', '00010000', '00000000', '00000000', '00000000', '00000000', '00000000'],
      ['00000000', '00000000', '00010000', '00000000', '00000000', '00000000', '00000000', '00000000']), { eaten: 0, trampled: 0, field: ['00000000', '00333000', '00303000', '00333000', '00000000', '00000000', '00000000', '00000000'] });
  check('crows: a scarecrow on a rotten plant tramples it back to a seed',
    nightAt(['00000000', '00000000', '00040000', '00000000', '00000000', '00000000', '00000000', '00000000'], 6.5 / 8, 6.5 / 8,
      ['00000000', '00000000', '00010000', '00000000', '00000000', '00000000', '00000000', '00000000']), { eaten: 0, trampled: 1, field: NONE });
  check('crows: the report totals match the season, over 100 days with and without scarecrows',
    [null, SMART_SCARE].map(src => {
      const p = AcresCore.compileProgram(src || SMART), st = AcresCore.newSeason(crow.seed, crow);
      while (st.day < RULES.days) AcresCore.advance(st, AcresCore.runHarvest(p.harvest, st.field), src ? AcresCore.runScare(p.scare, st.field) : null);
      return st.history.reduce((t, d) => t + d.eaten, 0) === st.eaten && st.history.length === RULES.days;
    }), [true, true]);
  const scareErr = src => { try { AcresCore.runScare(AcresCore.compileProgram(src).scare, AcresCore.newSeason(1).field); return 'ok'; } catch (e) { return e.message; } };
  check('scare: at most two scarecrows', [scareErr('Harvest←{0}\nScare←{⍵≥0}'), scareErr('Harvest←{0}\nScare←{0}')],
    ['Scare placed 64 scarecrows, but you only have 2', 'ok']);
  check('bests: an experimental farm keeps its bests under its board version, so new rules start them fresh',
    [AcresCore.bestKey('v2', 'crowhurst-farm'), AcresCore.bestKey('v2', 'middlebourne-farm')], ['v2:crowhurst-farm:1', 'v2:middlebourne-farm']);
  check('scare: Gold on any farm unlocks Crowhurst Farm', AcresCore.progress({ 'v2:marshgate-farm': { score: 1200 } }).farms.has('crowhurst-farm'), true);
}

// Missed bumper crops: ripe plants harvested alone, for 1 point, from a square where one could have formed.
{
  const day = (field, mask) => {
    const st = AcresCore.newSeason(1);
    st.field = grid(field); st.rng = () => 0.99; // nothing grows or rots
    AcresCore.advance(st, grid(mask));
    return st.history[0].missed;
  };
  const SQUARE = ['32000000', '22000000', '00000000', '00000000', '00000000', '00000000', '00000300', '00000000'];
  const RIPE_SQUARE = ['33000000', '33000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000'];
  const NONE = Array(8).fill('00000000');
  check('missed: a ripe plant taken from a square of growing and ripe plants counts', day(SQUARE, ['10000000', ...NONE.slice(1)]), 1);
  check('missed: a ripe plant with no such square around it does not', day(SQUARE, [...NONE.slice(0, 6), '00000100', '00000000']), 0);
  check('missed: harvesting a whole bumper crop misses nothing', day(RIPE_SQUARE, ['11000000', '11000000', ...NONE.slice(2)]), 0);
  check('missed: taking part of a ripe square counts each plant taken', day(RIPE_SQUARE, ['11000000', ...NONE.slice(1)]), 2);
  const season = src => {
    const fn = AcresCore.compileHarvest(src), st = AcresCore.newSeason(AcresCore.FARMS[0].seed, AcresCore.FARMS[0]);
    while (st.day < RULES.days) AcresCore.advance(st, AcresCore.runHarvest(fn, st.field));
    return st.history.reduce((a, d) => a + d.missed, 0);
  };
  const greedy = season('Harvest←{⍵≥Ripe}'), hybrid = season(fs.readFileSync(path.join(__dirname, '..', 'reference', 'hybrid.apl'), 'utf8'));
  check('missed: over a season, harvesting at once misses far more bumper crops than waiting for them', greedy > hybrid * 3, true);
}

// 13. Blightwick Farm: blight spreads to living neighbours, even from plants cleared that day, but never
// into seeds or rotten plants, so a freshly harvested plot is a firebreak.
{
  const BL = AcresCore.FARMS.find(f => f.blight), B = RULES.blighted;
  check('blight: Blightwick Farm has 50% spread, is experimental, and unlocks with Gold like Crowhurst',
    [BL.name, BL.blight.spread, BL.boardVersion, AcresCore.unlockFor('farm', BL.id).id], ['Blightwick Farm', 0.5, 1, 'any-gold']);
  const start = AcresCore.newSeason(BL.seed, BL).field.flat();
  check('blight: a season starts with a few blighted plants', start.filter(v => v === B).length >= 1 && start.filter(v => v === B).length <= 3, true);
  // A night where every roll is 0.45: below 50%, so blight always spreads; growth happens; no rot, no outbreak.
  const night = (field, mask) => {
    const st = AcresCore.newSeason(1, BL);
    st.field = grid(field); st.rng = () => 0.45;
    AcresCore.advance(st, grid(mask || Array(8).fill('00000000')));
    return st;
  };
  const centre = ['00000000', '00000000', '00020000', '00253000', '00010000', '00000000', '00000000', '00000000'];
  let st = night(centre);
  check('blight: it spreads to living plants above, below, left and right', [st.field[2][3], st.field[3][2], st.field[3][4], st.field[4][3]], [B, B, B, B]);
  check('blight: but not diagonally, and a blighted plant never grows or ripens', [st.field[2][2], st.field[4][4], st.field[3][3]], [1, 1, B]);
  check('blight: plants it reaches are counted as lost', [st.history[0].blighted, st.blighted], [4, 4]);
  st = night(['00000000', '00000000', '00040000', '00050000', '00000000', '00000000', '00000000', '00000000']);
  check('blight: seeds and rotten plants can’t catch it, even if a seed sprouts that night', [st.field[2][3], st.field[4][3], st.field[3][2]], [4, 1, 1]);
  st = night(centre, ['00000000', '00000000', '00000000', '00010000', '00000000', '00000000', '00000000', '00000000']);
  check('blight: clearing it is free, not wasted, but its spores still spread that night', [st.score, st.wasted, st.field[3][3] !== B, st.field[2][3], st.field[3][4]], [0, 0, true, B, B]);
  st = night(centre, ['00000000', '00000000', '00010000', '00101000', '00010000', '00000000', '00000000', '00000000']);
  check('blight: harvesting its neighbours first makes a firebreak it can’t cross', st.field.flat().filter(v => v === B).length, 1);
  const play = src => { const fn = AcresCore.compileHarvest(src), s2 = AcresCore.newSeason(BL.seed, BL); while (s2.day < RULES.days) AcresCore.advance(s2, AcresCore.runHarvest(fn, s2.field)); return s2.score; };
  const NEAR = 'Near←{(1↓⍵⍪0)∨(¯1↓0⍪⍵)∨(0 1↓⍵,0)∨0 ¯1↓0,⍵}\n';
  const scores = [
    play('Harvest←{⍵=Ripe}'),
    play('Harvest←{⍵≥Ripe}'),
    play('Harvest←{(⍵≥Rotten)∨(BumperCrops ⍵)∨(⍵=Ripe)∧~Promising ⍵}'),
    play(NEAR + 'Harvest←{n←Near ⍵=Blighted ⋄ (⍵≥Rotten)∨(BumperCrops ⍵)∨n∨(⍵=Ripe)∧~Promising ⍵}'),
  ];
  check('blight: never clearing collapses; clearing is Bronze, the usual Gold strategy Silver, firebreaks Gold',
    scores.map(sc => AcresCore.tierFor(BL, sc)), [null, 'bronze', 'silver', 'gold']);
  check('blight: the farm’s pinned scores', scores, [78, 1083, 1356, 1484]);
  const others = AcresCore.FARMS.filter(f => !f.blight).map(f => AcresCore.newSeason(f.seed, f).field.flat().includes(B));
  check('blight: no other farm ever has blight', others.every(x => !x), true);
}

// 14. Faithful to Dyalog: the kind of edge cases an APL expert tries first, with Dyalog's own answers
// (⎕IO←1, ⎕CT←1E¯14, ⎕PP←10): reduce and scan direction, overtake and negative take, tolerant
// comparison, ⍬, empty reductions, and how numbers are displayed.
{
  const DYALOG = [
    ["⍳5", "1 2 3 4 5"],
    ["⍴⍳0", "0"],
    ["-/1 2 3", "2"],
    ["-\\1 2 3", "1 ¯1 2"],
    ["÷/2 4 8", "4"],
    ["7↑1 2 3", "1 2 3 0 0 0 0"],
    ["¯5↑1 2", "0 0 0 1 2"],
    ["¯2↓⍳5", "1 2 3"],
    ["2⌽⍳5", "3 4 5 1 2"],
    ["¯1⌽⍳5", "5 1 2 3 4"],
    ["4∨6", "2"],
    ["4∧6", "12"],
    ["0∨5", "5"],
    ["2 3 4⍳3", "2"],
    ["2 3 4⍳9", "4"],
    ["⍸0 1 0 1", "2 4"],
    ["⍋3 1 2", "2 3 1"],
    ["⍒3 1 2", "1 3 2"],
    ["1 0 1/1 2 3", "1 3"],
    ["2/1 2", "1 1 2 2"],
    ["+/2 3⍴⍳6", "6 15"],
    ["+⌿2 3⍴⍳6", "5 7 9"],
    ["1 2 3+.×4 5 6", "32"],
    ["(+/÷≢)1 2 3 4", "2.5"],
    ["{⍺+⍵}/1 2 3", "6"],
    ["{⍵≤1:⍵ ⋄ (∇⍵-1)+∇⍵-2}10", "55"],
    ["{⍺←10 ⋄ ⍺+⍵}1", "11"],
    ["2*10", "1024"],
    ["7|23", "2"],
    ["¯7|23", "¯5"],
    ["⌈2.5", "3"],
    ["⌊¯2.5", "¯3"],
    ["0÷0", "1"],
    ["⊃1 2 3", "1"],
    ["-1 ¯2", "¯1 2"],
    ["×¯5 0 3", "¯1 0 1"],
    ["|¯3", "3"],
    ["≢2 3⍴0", "2"],
    ["≡1 2 3", "1"],
    ["3∊1 2 3", "1"],
    ["~1 0", "0 1"],
    ["1 2 3~2", "1 3"],
    ["+/⍳0", "0"],
    ["×/⍳0", "1"],
    ["3 3⍴⍳4", "1 2 3\n4 1 2\n3 4 1"],
    ["(2 2⍴⍳4)[2;1]", "3"],
    ["(⍳5)[2 4]", "2 4"],
    ["⊢/1 2 3", "3"],
    ["2-⍨5", "3"],
    ["+⍨3", "6"],
    ["(1∘+)3", "4"],
    ["{⍵×2}¨1 2", "2 4"],
    ["1.5=3÷2", "1"],
    ["1E3", "1000"],
    ["(0.1+0.2)=0.3", "1"],
    ["(0.1+0.2)≠0.3", "0"],
    ["0.3≤0.1+0.2", "1"],
    ["0.3<0.1+0.2", "0"],
    ["(0.1+0.2)∊0.3", "1"],
    ["0.3⍳0.1+0.2", "1"],
    ["(0.1+0.2)≡0.3", "1"],
    ["1↑⍬", "0"],
    ["⍬≡⍳0", "1"],
    ["⍴⍬", "0"],
    ["÷3", "0.3333333333"],
    ["2*0.5", "1.414213562"],
    ["1÷7", "0.1428571429"],
    ["1E20", "1E20"],
    ["÷1E7", "1E¯7"],
    ["⌈/⍳0", "¯1.797693135E308"],
    ["0.1+0.2", "0.3"],
  ];
  const differ = DYALOG.filter(([e, want]) => ev(e) !== want).map(([e, want]) => `${e} gave ${ev(e)}, Dyalog gives ${want}`);
  check(`dyalog: ${DYALOG.length} expert edge cases give Dyalog's answers`, differ, []);
}

// 15. Tutorial Farm: a 4×4 field and a 20-day season, the first farm a new player meets, with no medals.
// The other farms keep their 8×8 fields and 100 days, and their pinned scores above prove they play exactly as before.
{
  const TF = AcresCore.FARMS.find(f => f.tutorial);
  check('tutorial: Tutorial Farm is 4×4 with a 20-day season, on Middlebourne Farm’s weather',
    [TF.name, TF.size, TF.days, TF.sunshine, TF.rainfall], ['Tutorial Farm', 4, 20, 0.55, 0.20]);
  check('tutorial: every other farm is still 8×8 with a 100-day season',
    AcresCore.FARMS.filter(f => !f.tutorial).every(f => f.size === 8 && f.days === 100), true);
  const st0 = AcresCore.newSeason(TF.seed, TF);
  check('tutorial: its field is 4×4 and starts with every kind of plant on show',
    [st0.field.length, st0.field.every(r => r.length === 4), new Set(st0.field.flat()).size, st0.days], [4, true, 4, 20]);
  const play = src => { const fn = AcresCore.compileHarvest(src), st = AcresCore.newSeason(TF.seed, TF); while (st.day < st.days) AcresCore.advance(st, AcresCore.runHarvest(fn, st.field)); return [st.score, st.wasted, st.day]; };
  check('tutorial: ⍵=Ripe plays 20 days, scores 59 and wastes nothing', play('Harvest←{⍵=Ripe}'), [59, 0, 20]);
  check('tutorial: ⍵=Growing wastes plants, as the tutorial shows', play('Harvest←{⍵=Growing}')[1] > 0, true);
  let err = '';
  try { AcresCore.runHarvest(AcresCore.compileHarvest('Harvest←{8 8⍴1}'), st0.field); } catch (e) { err = e.message; }
  check('tutorial: Harvest must answer with a 4×4 field here', /must return a 4×4 matrix/.test(err), true);
  check('tutorial: it doesn’t count as "any farm" for Gold', AcresCore.progress({ 'v2:tutorial-farm': { score: 999 } }).farms.has('crowhurst-farm'), false);
  check('tutorial: it’s open to a new player, alongside Middlebourne Farm', [...AcresCore.progress({}).farms], ['tutorial-farm', 'middlebourne-farm']);
}

console.log(failures ? `${failures} of ${checks} checks failed` : `All ${checks} checks passed`);
process.exit(failures ? 1 : 0);
