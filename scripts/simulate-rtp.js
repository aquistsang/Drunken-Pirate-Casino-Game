/**
 * Monte Carlo RTP simulator for The Drunken Pirate.
 * Run: npm run simulate
 */
import {
  HIT_PROB,
  STREAK_TRIGGER_HITS,
  STREAK_JACKPOT_MULT,
  WHEEL_APPLE_PROB,
  BUYIN_COST_MULT,
  BUYIN_APPLE_MULT
} from "../src/constants.js";

function multAtHit(hits) {
  return Math.pow(2, hits);
}

function rollHit() {
  return Math.random() < HIT_PROB;
}

function rollWheelApple() {
  return Math.random() < WHEEL_APPLE_PROB;
}

function resolveStreakWheel(wheelPolicy) {
  if (wheelPolicy === "take") return 32;
  return rollWheelApple() ? STREAK_JACKPOT_MULT : 0;
}

function resolveBuyinPayout() {
  return rollWheelApple() ? BUYIN_APPLE_MULT : 0;
}

/** Cash out after exactly `stopAtHit` hits (1 = classic 97% path). */
function playBaseStopAt(stopAtHit) {
  let hits = 0;
  while (true) {
    if (!rollHit()) return 0;
    hits += 1;
    if (hits >= stopAtHit) return multAtHit(hits);
  }
}

/** Keep shooting while hitting; never cash early; bust = 0; at 5 hits take 32×. */
function playBaseAlways() {
  let hits = 0;
  while (true) {
    if (!rollHit()) return 0;
    hits += 1;
    if (hits >= STREAK_TRIGGER_HITS) return 32;
  }
}

/** Optimal stop rule via backward induction (hits 1..4 only). */
function buildOptimalStopRule() {
  const maxHits = STREAK_TRIGGER_HITS - 1;
  const ev = new Array(maxHits + 2).fill(0);
  for (let h = maxHits; h >= 1; h--) {
    ev[h] = Math.max(multAtHit(h), HIT_PROB * ev[h + 1]);
  }
  const stopAt = [];
  for (let h = 1; h <= maxHits; h++) {
    stopAt[h] = multAtHit(h) >= HIT_PROB * ev[h + 1];
  }
  return { evAtFirstHit: ev[1], stopAt };
}

function playBaseOptimal(stopAt) {
  let hits = 0;
  while (true) {
    if (!rollHit()) return 0;
    hits += 1;
    if (hits >= STREAK_TRIGGER_HITS) return 32;
    if (stopAt[hits]) return multAtHit(hits);
  }
}

function playStreakWheel(wheelPolicy) {
  for (let h = 0; h < STREAK_TRIGGER_HITS; h++) {
    if (!rollHit()) return 0;
  }
  return resolveStreakWheel(wheelPolicy);
}

function playFullPolicy({ stopAtHit, wheelPolicy }) {
  let hits = 0;
  while (true) {
    if (!rollHit()) return 0;
    hits += 1;
    if (hits === STREAK_TRIGGER_HITS) return resolveStreakWheel(wheelPolicy);
    if (stopAtHit != null && hits === stopAtHit) return multAtHit(hits);
  }
}

/**
 * @param {object} opts
 * @param {number} [opts.rounds]
 * @param {string} [opts.mode]
 * @param {object} [opts.policy]
 */
export function simulateFull(opts = {}) {
  const rounds = opts.rounds ?? 1_000_000;
  const mode = opts.mode ?? opts.policy?.mode ?? "base_1hit";
  const policy = opts.policy ?? {};
  const wheelPolicy = policy.wheelPolicy ?? "take";
  const buyInEveryRound = !!policy.buyInEveryRound;
  const optimal = buildOptimalStopRule();

  let totalWagered = 0;
  let totalReturned = 0;
  let baseReturned = 0;
  let wheelReturned = 0;
  let buyinReturned = 0;
  let hitCount = 0;
  let wheelSpins = 0;
  let wheelApples = 0;

  for (let i = 0; i < rounds; i++) {
    let wagered = 1;
    let returned = 0;

    if (mode === "base_1hit") {
      returned = playBaseStopAt(1);
      baseReturned += returned;
    } else if (mode === "base_always") {
      returned = playBaseAlways();
      baseReturned += returned;
    } else if (mode === "base_optimal") {
      returned = playBaseOptimal(optimal.stopAt);
      baseReturned += returned;
    } else if (mode === "streak_take") {
      returned = playStreakWheel("take");
      wheelReturned += returned;
      wheelSpins += 1;
      if (returned === STREAK_JACKPOT_MULT) wheelApples += 1;
    } else if (mode === "streak_gamble") {
      returned = playStreakWheel("gamble");
      wheelReturned += returned;
      wheelSpins += 1;
      if (returned === STREAK_JACKPOT_MULT) wheelApples += 1;
    } else if (mode === "buyin_every_round") {
      wagered = BUYIN_COST_MULT;
      returned = resolveBuyinPayout();
      buyinReturned += returned;
      wheelSpins += 1;
      if (returned > 0) wheelApples += 1;
    } else if (mode === "full_policy") {
      returned = playFullPolicy({
        stopAtHit: policy.stopAtHit ?? null,
        wheelPolicy
      });
      if (returned === 32 || returned === STREAK_JACKPOT_MULT) {
        wheelReturned += returned;
        wheelSpins += 1;
        if (returned === STREAK_JACKPOT_MULT) wheelApples += 1;
      } else {
        baseReturned += returned;
      }
    } else {
      returned = playBaseStopAt(policy.stopAtHit ?? 1);
      baseReturned += returned;
    }

    if (buyInEveryRound && mode !== "buyin_every_round") {
      wagered += BUYIN_COST_MULT;
      const buyinPay = resolveBuyinPayout();
      returned += buyinPay;
      buyinReturned += buyinPay;
      wheelSpins += 1;
      if (buyinPay > 0) wheelApples += 1;
    }

    if (rollHit()) hitCount += 1;
    totalWagered += wagered;
    totalReturned += returned;
  }

  const rtp = totalReturned / totalWagered;
  return {
    mode,
    rounds,
    rtp,
    rtpPct: rtp * 100,
    stderr: Math.sqrt(rtp * (1 - rtp) / rounds),
    hitRate: hitCount / rounds,
    wheelAppleRate: wheelSpins > 0 ? wheelApples / wheelSpins : 0,
    optimalBaseEv: optimal.evAtFirstHit,
    breakdown: {
      base: baseReturned / totalWagered,
      wheel: wheelReturned / totalWagered,
      buyin: buyinReturned / totalWagered
    },
    totalWagered,
    totalReturned
  };
}

function printResult(result) {
  console.log(`\n=== ${result.mode} (${result.rounds.toLocaleString()} rounds) ===`);
  console.log(`  RTP: ${result.rtpPct.toFixed(3)}% ± ${(result.stderr * 100).toFixed(3)}%`);
  if (result.mode === "base_optimal") {
    console.log(`  Analytic optimal EV (1-hit continue): ${result.optimalBaseEv.toFixed(4)}×`);
  }
  const { base, wheel, buyin } = result.breakdown;
  if (wheel > 0 || buyin > 0) {
    console.log(`  Breakdown: base ${(base * 100).toFixed(2)}%, wheel ${(wheel * 100).toFixed(2)}%, buy-in ${(buyin * 100).toFixed(2)}%`);
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("simulate-rtp.js");
if (isMain) {
  const rounds = Number(process.env.ROUNDS) || 500_000;
  console.log("The Drunken Pirate — RTP Simulator");
  console.log(`Hit prob: ${(HIT_PROB * 100).toFixed(1)}% | Wheel apple: ${(WHEEL_APPLE_PROB * 100).toFixed(2)}%`);
  console.log(`Target base (1-hit cash-out): ${(HIT_PROB * 2 * 100).toFixed(1)}%`);
  console.log(`Target streak gamble EV: ${(WHEEL_APPLE_PROB * STREAK_JACKPOT_MULT).toFixed(1)}×`);
  console.log(`Target buy-in EV: ${(WHEEL_APPLE_PROB * BUYIN_APPLE_MULT / BUYIN_COST_MULT * 100).toFixed(1)}% RTP`);

  [
    { mode: "base_1hit" },
    { mode: "base_always" },
    { mode: "base_optimal" },
    { mode: "streak_take" },
    { mode: "streak_gamble" },
    { mode: "buyin_every_round" },
    { mode: "full_policy", policy: { wheelPolicy: "take", buyInEveryRound: false } },
    { mode: "full_policy", policy: { wheelPolicy: "gamble", buyInEveryRound: true } }
  ].forEach((cfg) => printResult(simulateFull({ rounds, ...cfg, policy: cfg.policy })));
}
