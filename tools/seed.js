/* Generates public/seed.js (the starting board) from the stakeholder list. Run: npm run seed */
const fs = require('fs');
const path = require('path');

const GAMES = [
  ['Merge Chain', 'G'], ['Bitcoin Ball Spinner', 'G'], ['Idle Zen Merge', 'G'], ['Ring Breaker', 'G'], ['Bitcoin Plinko', 'G'],
  ['Coins Factory', 'G'], ['Bits N Blocks', 'G'], ['Goal Flick', 'G'], ['Ropes N Cash', 'G'],
  ['Maze Mania', 'Y'], ['Unpin It', 'Y'], ['Pop The Gems', 'Y'], ['Ball Bounce Shooter 3D', 'Y'], ['Hole Collector 3D', 'Y'],
  ['Bitcoin Dot Blaster', 'Y'], ['Draw Rope 3D', 'Y'], ['Ball Block Merge', 'Y'], ['Bounce Breakers', 'Y'], ['Pinball - Gems Mania', 'Y'],
  ['Bitcoin Splash', 'O'], ['Dig N Drop', 'O'], ['Bitcoin Planet Miner', 'O'], ['Gold Merge Miners', 'O'], ['Idle Crusher Tycoon', 'O'],
  ['Gold Craft Tycoon', 'R'], ['Idle Coins', 'R'], ['Bitcoin Coin Collector', 'R']
];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const T = (d, o) => ({ d, o });
/* Relative effort per stage in days. The board scales these to fit the end date.
   Cleanup, WebGL and SDK flow to whichever dev is free; Opt·H stays Hemil (the cap), Opt·R stays Rakesh. */
const tiers = {
  G: { art: T(0.5, 'sarbjeet'), clean: T(0.5, 'any:dev'), optH: T(0.5, 'hemil'), optR: T(0.5, 'rakesh'), webgl: T(1, 'any:dev'), sdk: T(0.5, 'any:dev') },
  Y: { art: T(1.5, 'sarbjeet'), clean: T(0.5, 'any:dev'), optH: T(0.5, 'hemil'), optR: T(1, 'rakesh'), webgl: T(1.5, 'any:dev'), sdk: T(0.5, 'any:dev') },
  O: { art: T(3, 'sarbjeet'), clean: T(1, 'any:dev'), optH: T(1, 'hemil'), optR: T(2, 'rakesh'), webgl: T(2, 'any:dev'), sdk: T(0.5, 'any:dev') },
  R: { art: T(5, 'sarbjeet'), clean: T(1, 'any:dev'), optH: T(1, 'hemil'), optR: T(3, 'rakesh'), webgl: T(2.5, 'any:dev'), sdk: T(0.5, 'any:dev') },
  K: { art: T(0, 'sarbjeet'), clean: T(0, 'hemil'), optH: T(0, 'hemil'), optR: T(0, 'rakesh'), webgl: T(2, 'rakesh'), sdk: T(1, 'hemil') }
};
const checklists = {
  art: ['Textures: max 1024, packed into atlases, unused ones deleted', '3D: poly count cut, one material per prop where possible', 'Audio: mono, compressed, silence trimmed', 'Optimized pack in the shared folder, dev pinged'],
  clean: ['Mobile SDKs out: ads, IAP, analytics, push, rating prompts', 'Every rewarded-ad call swapped to the kit\'s Platform stub', 'Unused scenes, plugins and resources deleted', 'Project builds with zero errors'],
  optH: ['Texture compression + max size set in import settings', 'Unused assets and packages stripped, managed stripping High', 'Audio compressed, mono', 'STOP when the time box runs out. Note what is left, hand to Rakesh'],
  optR: ['Finish what Hemil noted, drop in Sarbjeet\'s optimized pack', 'Shader variants trimmed, code stripping on, heavy scenes lazy-loaded', 'Under the platform size limit', 'Quick memory / perf check in a WebGL build'],
  webgl: ['Built from the kit template: landscape UI, canvas scaler, input', 'Mouse and touch both work, no mobile-only calls left', 'Brotli build, loading screen, first load within target', 'One full playthrough in Chrome, console clean'],
  sdk: ['Platform adapter plugged in (config swap, no game code edits)', 'Rewarded ad flow works end to end, gameplay start/stop events fire', 'Uploaded to the platform dev dashboard, its checklist passed', 'Tap Done here. That counts as shipped.']
};
const rules = [
  'Every stage has a time box that fits the end date. When the box runs out, note what is left, hand over, move on.',
  'Cleanup, WebGL and SDK go to whichever dev is free first. The board decides, you just tap Done.',
  'Hemil\'s optimization box is a hard cap. At the box, hand to Rakesh. No heroics.',
  'Sarbjeet runs ahead on heavy games so nobody waits on art.',
  'One kit for everything: template + platform adapter. Never build from scratch.',
  'Tap Done the moment it is done. The plan re-fits itself and the whole team sees it.'
];

function seed() {
  const games = GAMES.map(([name, tier], i) => ({ id: slug(name), name, tier, prio: i + 1, st: {} }));
  games.unshift({ id: 'kit', name: 'WebGL Kit', tier: 'K', prio: 0, st: {},
    note: 'Rakesh: one WebGL template project (landscape UI canvas, scaler, input, build settings, Brotli, loading screen). Hemil: Platform adapter interface + one implementation per client platform, and the cleanup checklist. Every game after this reuses both.' });
  return {
    v: 2,
    people: {
      hemil: { name: 'Hemil', role: 'Dev' },
      rakesh: { name: 'Rakesh', role: 'Dev' },
      sarbjeet: { name: 'Sarbjeet', role: 'Artist' },
      producer: { name: 'Producer', role: 'Producer' }
    },
    settings: { planFrom: '2026-09-07', deadline: '2026-10-16', target: 27, order: 'auto', mixN: 4, holidays: [], off: { hemil: [], rakesh: [], sarbjeet: [], producer: [] }, tiers, checklists, rules },
    games,
    log: []
  };
}
module.exports = seed;
if (require.main === module) {
  const out = path.join(__dirname, '..', 'public', 'seed.js');
  fs.writeFileSync(out, '/* Starting board. Generated by tools/seed.js — edit that file, not this one. */\nwindow.SEED = ' + JSON.stringify(seed()) + ';\n');
  console.log('wrote', out);
}
