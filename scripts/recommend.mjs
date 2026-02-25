import fs from "fs";

const DATA_PATH = "data/lotto.json";

function readData() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const arr = JSON.parse(raw);
  return Array.isArray(arr) ? arr : [];
}

function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}

function overlapCount(a, b) {
  const s = new Set(a);
  let c = 0;
  for (const x of b) if (s.has(x)) c++;
  return c;
}

function sortByScore(nums, scoreMap) {
  return nums.slice().sort((a, b) => (scoreMap[b] - scoreMap[a]) || (a - b));
}

function computeStats(draws) {
  const countsAll = Array(46).fill(0);
  const countsRecent = Array(46).fill(0);

  const sorted = draws.slice().sort((a, b) => (a.drwNo || 0) - (b.drwNo || 0));
  const latest = sorted[sorted.length - 1] || null;

  const RECENT_N = 80;
  const recent = sorted.slice(-RECENT_N);

  for (const d of sorted) for (const n of (d.nums || [])) countsAll[n]++;
  for (const d of recent) for (const n of (d.nums || [])) countsRecent[n]++;

  const maxAll = Math.max(...countsAll.slice(1), 1);
  const maxRecent = Math.max(...countsRecent.slice(1), 1);

  const score = Array(46).fill(0);
  const scoreRecentHeavy = Array(46).fill(0);
  const scoreAntiRecent = Array(46).fill(0);

  for (let n = 1; n <= 45; n++) {
    const a = countsAll[n] / maxAll;
    const r = countsRecent[n] / maxRecent;
    score[n] = a * 0.8 + r * 0.2;           // 기본
    scoreRecentHeavy[n] = a * 0.5 + r * 0.5; // 최근 가중
    scoreAntiRecent[n] = a - r * 0.6;        // 최근 회피
  }

  const allNums = [...Array(45)].map((_, i) => i + 1);
  const orderByAll = allNums.slice().sort((a, b) => (countsAll[b] - countsAll[a]) || (a - b));

  return { sorted, latest, score, scoreRecentHeavy, scoreAntiRecent, orderByAll };
}

function pickFromOrdered(ordered, k, shift = 0, rule = null) {
  const out = [];
  const used = new Set();
  const start = Math.max(0, shift | 0);

  for (let i = start; i < ordered.length && out.length < k; i++) {
    const n = ordered[i];
    if (used.has(n)) continue;
    if (rule && !rule(n, out)) continue;
    used.add(n);
    out.push(n);
  }

  // 부족하면 룰 없이 채움
  if (out.length < k) {
    for (let i = start; i < ordered.length && out.length < k; i++) {
      const n = ordered[i];
      if (used.has(n)) continue;
      used.add(n);
      out.push(n);
    }
  }

  return out.sort((a, b) => a - b);
}

// --- 전략들(랜덤 없음) ---
function setTop6(st, shift = 0) {
  const ordered = sortByScore([...Array(45)].map((_, i) => i + 1), st.score);
  return pickFromOrdered(ordered, 6, shift);
}

function setRangeBalance(st, shift = 0) {
  const pick2 = (min, max, s) => {
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    const ordered = sortByScore(pool, st.score);
    return pickFromOrdered(ordered, 2, s);
  };
  const a = pick2(1, 15, shift);
  const b = pick2(16, 30, shift);
  const c = pick2(31, 45, shift);
  return uniqSorted([...a, ...b, ...c]).slice(0, 6);
}

function setOddEven33(st, shift = 0) {
  const all = [...Array(45)].map((_, i) => i + 1);
  const odds = all.filter((n) => n % 2 === 1);
  const evens = all.filter((n) => n % 2 === 0);
  const o = pickFromOrdered(sortByScore(odds, st.score), 3, shift);
  const e = pickFromOrdered(sortByScore(evens, st.score), 3, shift);
  return uniqSorted([...o, ...e]).slice(0, 6);
}

function setEndDigitSpread(st, shift = 0) {
  const ordered = sortByScore([...Array(45)].map((_, i) => i + 1), st.score);
  const usedDigit = new Set();
  const rule = (n) => {
    const d = n % 10;
    if (usedDigit.has(d)) return false;
    usedDigit.add(d);
    return true;
  };
  return pickFromOrdered(ordered, 6, shift, rule);
}

function setNoAdj(st, shift = 0) {
  const ordered = sortByScore([...Array(45)].map((_, i) => i + 1), st.score);
  const rule = (n, out) => out.every((x) => Math.abs(x - n) > 1);
  return pickFromOrdered(ordered, 6, shift, rule);
}

function setMinGap3(st, shift = 0) {
  const ordered = sortByScore([...Array(45)].map((_, i) => i + 1), st.score);
  const rule = (n, out) => out.every((x) => Math.abs(x - n) >= 3);
  return pickFromOrdered(ordered, 6, shift, rule);
}

function setLowHigh33(st, shift = 0) {
  const low = [];
  const high = [];
  for (let n = 1; n <= 45; n++) (n <= 22 ? low : high).push(n);
  const l = pickFromOrdered(sortByScore(low, st.score), 3, shift);
  const h = pickFromOrdered(sortByScore(high, st.score), 3, shift);
  return uniqSorted([...l, ...h]).slice(0, 6);
}

function setRecentHeavy(st, shift = 0) {
  const ordered = sortByScore([...Array(45)].map((_, i) => i + 1), st.scoreRecentHeavy);
  return pickFromOrdered(ordered, 6, shift);
}

function setAntiRecent(st, shift = 0) {
  const pool = st.orderByAll.slice(0, 35);
  const ordered = sortByScore(pool, st.scoreAntiRecent);
  return pickFromOrdered(ordered, 6, shift);
}

function setTopPool(st, shift = 0) {
  const pool = st.orderByAll.slice(0, 30);
  const ordered = sortByScore(pool, st.score);
  return pickFromOrdered(ordered, 6, shift);
}

const STRATEGIES = [
  { name: "TOP 6", make: setTop6 },
  { name: "구간 균형", make: setRangeBalance },
  { name: "홀짝 3:3", make: setOddEven33 },
  { name: "끝수 분산", make: setEndDigitSpread },
  { name: "근접수 회피", make: setNoAdj },
  { name: "간격 분산", make: setMinGap3 },
  { name: "저/고 3:3", make: setLowHigh33 },
  { name: "최근 가중", make: setRecentHeavy },
  { name: "최근 회피", make: setAntiRecent },
  { name: "상위풀 엄선", make: setTopPool },
];

function pickDiverse(st, strat, prev, overlapLimit, baseShift) {
  const MAX_SHIFT = 30;
  for (let s = 0; s <= MAX_SHIFT; s++) {
    const nums = strat.make(st, baseShift + s);
    let ok = true;
    for (const p of prev) {
      if (overlapCount(p, nums) > overlapLimit) { ok = false; break; }
    }
    if (ok) return nums;
  }
  return strat.make(st, baseShift);
}

function buildSets(st, count) {
  const outNums = [];
  const out = [];

  const overlapLimit = count >= 10 ? 4 : (count >= 5 ? 5 : 6);

  for (let i = 0; i < count; i++) {
    const strat = STRATEGIES[i % STRATEGIES.length];
    const baseShift = i * 2; // 세트 간 분산(랜덤 없음)
    const nums = pickDiverse(st, strat, outNums, overlapLimit, baseShift);
    outNums.push(nums);
    out.push({ idx: i + 1, name: strat.name, nums });
  }
  return out;
}

function fmt(nums) {
  return nums.join(", ");
}

const draws = readData();
if (!draws.length) {
  console.log("NO_DATA");
  process.exit(0);
}

const st = computeStats(draws);
if (!st.latest) {
  console.log("NO_DATA");
  process.exit(0);
}

const sets10 = buildSets(st, 10);

const lines = [];
lines.push("✅ 로또 추천(빈도 기반 · 랜덤 없음)");
lines.push(`- 데이터 회차 수: ${st.sorted.length}`);
lines.push(`- 최신 회차: ${st.latest.drwNo} (${st.latest.drwNoDate || ""})`);
lines.push("");
lines.push("【1세트】");
lines.push(`1) ${fmt(sets10[0].nums)}  (${sets10[0].name})`);
lines.push("");
lines.push("【5세트】");
for (let i = 0; i < 5; i++) lines.push(`${i + 1}) ${fmt(sets10[i].nums)}  (${sets10[i].name})`);
lines.push("");
lines.push("【10세트】");
for (let i = 0; i < 10; i++) lines.push(`${i + 1}) ${fmt(sets10[i].nums)}  (${sets10[i].name})`);

console.log(lines.join("\n"));
