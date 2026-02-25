// scripts/update_lotto.mjs
import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.resolve("data/lotto.json");
const API_BASE = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "lotto-issueops/1.0 (github-actions)"
      },
      signal: ctrl.signal
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`[HTTP ${res.status}] ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

function extractJson(text) {
  const s = text.trim();

  // 정상 JSON이면 바로 파싱
  if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);

  // 가끔 앞뒤에 이상한 문자가 붙는 경우 대비
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = s.slice(first, last + 1);
    return JSON.parse(slice);
  }

  throw new Error(`[lotto] response is not JSON: ${s.slice(0, 200)}`);
}

async function fetchDrawRaw(no) {
  const url = `${API_BASE}${no}`;
  const text = await fetchText(url);
  return extractJson(text);
}

function normalizeDraw(obj) {
  if (!obj || obj.returnValue !== "success") return null;

  const nums = [
    obj.drwtNo1, obj.drwtNo2, obj.drwtNo3,
    obj.drwtNo4, obj.drwtNo5, obj.drwtNo6
  ].map(Number);

  const bonus = Number(obj.bnusNo);
  const drawNo = Number(obj.drwNo);
  const drawDate = String(obj.drwNoDate || "");

  if (!drawNo || nums.some((n) => !Number.isFinite(n)) || !Number.isFinite(bonus)) return null;

  nums.sort((a, b) => a - b);

  return {
    no: drawNo,
    date: drawDate,
    numbers: nums,
    bonus
  };
}

async function isSuccess(no) {
  const raw = await fetchDrawRaw(no);
  return raw?.returnValue === "success";
}

async function findLatestDrawNo() {
  // ✅ drwNo=1도 실패하면 API 접근 자체가 안 되는 거라서 "성공처럼 끝내면 안 됨"
  const ok1 = await isSuccess(1);
  if (!ok1) {
    throw new Error("[lotto] 동행복권 API 접근 실패: drwNo=1도 success가 아닙니다. (네트워크/차단/응답변조 가능)");
  }

  let hi = 1;
  while (await isSuccess(hi)) {
    hi *= 2;
    // 너무 빠르게 두드리면 막히는 경우가 있어서 약간 쉬기
    await sleep(120);
    if (hi > 10000) break;
  }

  let lo = Math.floor(hi / 2);
  let left = lo;
  let right = hi;

  while (left + 1 < right) {
    const mid = Math.floor((left + right) / 2);
    const ok = await isSuccess(mid);
    await sleep(80);

    if (ok) left = mid;
    else right = mid;
  }
  return left;
}

async function readExisting() {
  try {
    const s = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJson(obj) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function main() {
  const existing = await readExisting();
  const map = new Map();

  for (const d of existing) {
    if (d && typeof d.no === "number") map.set(d.no, d);
  }

  const latest = await findLatestDrawNo();

  // 기존이 비어있으면 1부터, 아니면 마지막+1부터
  const existingNos = [...map.keys()];
  const start = existingNos.length ? Math.max(...existingNos) + 1 : 1;

  console.log(`[lotto] latest=${latest}, start=${start}, existing=${existingNos.length}`);

  const fetched = [];
  for (let n = start; n <= latest; n++) {
    const raw = await fetchDrawRaw(n);
    const norm = normalizeDraw(raw);
    if (norm) {
      fetched.push(norm);
      map.set(norm.no, norm);
      console.log(`[lotto] +${norm.no} (${norm.date}) ${norm.numbers.join(",")} +${norm.bonus}`);
    } else {
      throw new Error(`[lotto] draw ${n} fetch failed (returnValue=${raw?.returnValue})`);
    }
    await sleep(80);
  }

  const merged = [...map.values()].sort((a, b) => a.no - b.no);

  // ✅ merged가 0이면 “성공”으로 끝내지 말고 실패 처리해서 Actions 로그로 원인 보이게
  if (merged.length === 0) {
    throw new Error("[lotto] 업데이트 결과가 0건입니다. API가 막혔거나 응답이 비정상입니다.");
  }

  await writeJson(merged);

  console.log(`[lotto] done. total=${merged.length}, added=${fetched.length}`);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
