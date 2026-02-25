import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "lotto.json");

const SETS = Number(process.argv[2] ?? 10); // 1 / 5 / 10

function readNums(draw) {
  return [
    draw.drwtNo1, draw.drwtNo2, draw.drwtNo3,
    draw.drwtNo4, draw.drwtNo5, draw.drwtNo6
  ].map(Number);
}

function buildFreq(draws) {
  const freq = Array(46).fill(0);
  for (const d of draws) {
    for (const n of readNums(d)) {
      if (Number.isInteger(n) && n >= 1 && n <= 45) freq[n]++;
    }
  }
  return freq;
}

function sortedByFreq(freq) {
  const arr = [];
  for (let n = 1; n <= 45; n++) arr.push(n);
  arr.sort((a, b) => (freq[b] - freq[a]) || (a - b));
  return arr;
}

function pickFrom(list, used, offset, predicate = () => true) {
  for (let i = 0; i < list.length; i++) {
    const n = list[(i + offset) % list.length];
    if (!used.has(n) && predicate(n)) {
      used.add(n);
      return n;
    }
  }
  return null;
}

function makeSet(freq, base, idx) {
  const used = new Set();
  const hot = base.slice(0, 12);
  const mid = base.slice(12, 30);
  const cold = base.slice(-12);

  const pattern = idx % 4;

  // 패턴 A: 구간 분산(1~10/11~20/21~30/31~40/41~45 + 추가1)
  if (pattern === 0) {
    const ranges = [
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 40],
      [41, 45],
    ];
    for (let r = 0; r < ranges.length; r++) {
      const [a, b] = ranges[r];
      pickFrom(base, used, idx + r * 3, (n) => n >= a && n <= b);
    }
    // 추가 1개: 중간대(11~35)에서 빈도 높은 순으로
    pickFrom(base, used, idx * 2 + 1, (n) => n >= 11 && n <= 35);
  }

  // 패턴 B: 홀짝 3:3 + 핫 위주
  if (pattern === 1) {
    for (let i = 0; i < 3; i++) pickFrom(hot, used, idx + i * 2, (n) => n % 2 === 1);
    for (let i = 0; i < 3; i++) pickFrom(hot, used, idx + i * 2 + 1, (n) => n % 2 === 0);
  }

  // 패턴 C: 끝수 분산(0~9 최대한 겹치지 않게) + 빈도 순
  if (pattern === 2) {
    const usedLast = new Set();
    for (let i = 0; i < 6; i++) {
      const n = pickFrom(base, used, idx + i * 5, (x) => !usedLast.has(x % 10));
      if (n != null) usedLast.add(n % 10);
    }
    // 부족하면 그냥 채움
    while (used.size < 6) pickFrom(base, used, idx + used.size);
  }

  // 패턴 D: 핫+미드+콜드 믹스(3/2/1)
  if (pattern === 3) {
    for (let i = 0; i < 3; i++) pickFrom(hot, used, idx + i * 3);
    for (let i = 0; i < 2; i++) pickFrom(mid, used, idx + i * 4);
    pickFrom(cold, used, idx * 2 + 7);
  }

  const result = Array.from(used).sort((a, b) => a - b);

  // 안전장치: 혹시 덜 뽑히면 채움
  while (result.length < 6) {
    const n = pickFrom(base, used, idx + result.length * 7);
    if (n == null) break;
    result.push(n);
    result.sort((a, b) => a - b);
  }

  return result;
}

function mdLine(nums) {
  return nums.map((n) => String(n).padStart(2, "0")).join(" ");
}

async function main() {
  let draws = [];
  try {
    draws = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  } catch {
    draws = [];
  }

  if (!Array.isArray(draws) || draws.length === 0) {
    console.log(
      [
        "추천 번호 오류: 데이터가 비어있습니다 (data/lotto.json = []). update-lotto로 먼저 채우세요.",
        "데이터 파일 직접 확인: ./data/lotto.json",
        "* 추천은 확률 보장이 아닙니다. “과거 빈도 + 분산 규칙” 기반입니다.",
      ].join("\n")
    );
    return;
  }

  const freq = buildFreq(draws);
  const base = sortedByFreq(freq);
  const last = draws[draws.length - 1];

  const count = [1, 5, 10].includes(SETS) ? SETS : 10;

  const lines = [];
  lines.push(`✅ 데이터: ${draws.length}회차 (최근: ${last.drwNo} / ${last.drwNoDate})`);
  lines.push("");
  lines.push(`### 추천 ${count}세트 (랜덤 없음 / 빈도+분산 규칙)`);
  for (let i = 0; i < count; i++) {
    const set = makeSet(freq, base, i);
    lines.push(`- **${i + 1}**: \`${mdLine(set)}\``);
  }
  lines.push("");
  lines.push("> *추천은 확률 보장이 아닙니다. 과거 데이터 기반 분산 추천입니다.*");

  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
