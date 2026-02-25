import fs from "fs";
import path from "path";

const DATA_PATH = path.join("data", "lotto.json");
const ENDPOINT = (n) =>
  `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${n}`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  Referer: "https://www.dhlottery.co.kr/",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeReadJsonArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function safeWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

// {"returnValue": ... } 로 시작하는 JSON 객체만 추출(HTML/잡텍스트 섞여도 처리)
function extractReturnValueJson(text) {
  const re = /\{\s*"returnValue"\s*:/;
  const m = re.exec(text);
  if (!m) return null;

  const start = m.index;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;
  return text.slice(start, end + 1);
}

async function fetchJson(url, retry = 6) {
  let lastErr = null;

  for (let i = 0; i < retry; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      const text = await res.text();
      const trimmed = text.trim();

      // 1) 순수 JSON이면 그대로 파싱
      try {
        return JSON.parse(trimmed);
      } catch {
        // 2) 섞여 있으면 returnValue JSON만 추출해서 파싱
        const extracted = extractReturnValueJson(text);
        if (extracted) return JSON.parse(extracted);

        const head = trimmed.slice(0, 180).replace(/\s+/g, " ");
        throw new Error(`Non-JSON response (status=${res.status}). head="${head}"`);
      }
    } catch (e) {
      lastErr = e;
      await sleep(1200 + i * 1200);
    }
  }

  throw lastErr ?? new Error("fetchJson failed");
}

function normalizeDraw(j) {
  if (!j || j.returnValue !== "success") return null;

  const nums = [j.drwtNo1, j.drwtNo2, j.drwtNo3, j.drwtNo4, j.drwtNo5, j.drwtNo6]
    .map(Number)
    .filter(Number.isFinite);

  if (nums.length !== 6) return null;

  return {
    drwNo: Number(j.drwNo),
    drwNoDate: String(j.drwNoDate || ""),
    nums,
    bonus: Number(j.bnusNo),
  };
}

async function isSuccessDraw(n) {
  const j = await fetchJson(ENDPOINT(n), 4);
  return j && j.returnValue === "success";
}

async function findLatestDrawNo() {
  let lo = 1;
  let hi = 1;

  // hi를 2배씩 키우며 "fail"이 나올 때까지 탐색
  while (await isSuccessDraw(hi)) {
    lo = hi;
    hi *= 2;
    await sleep(120);
    if (hi > 20000) break;
  }

  // (lo=success, hi=fail) 사이 이분탐색
  let left = lo, right = hi;
  while (left + 1 < right) {
    const mid = Math.floor((left + right) / 2);
    const ok = await isSuccessDraw(mid);
    if (ok) left = mid;
    else right = mid;
    await sleep(120);
  }
  return left;
}

async function fetchRange(from, to, concurrency = 4) {
  const results = [];
  let cur = from;

  async function worker() {
    while (cur <= to) {
      const n = cur++;
      const j = await fetchJson(ENDPOINT(n), 6);
      const d = normalizeDraw(j);
      if (d) results.push(d);
      await sleep(160);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((a, b) => a.drwNo - b.drwNo);
  return results;
}

async function main() {
  const existing = safeReadJsonArray(DATA_PATH);
  const map = new Map(existing.map((d) => [Number(d.drwNo), d]));

  const latest = await findLatestDrawNo();
  const maxKnown = existing.reduce((m, d) => Math.max(m, Number(d.drwNo || 0)), 0);

  console.log(`[lotto] latest(drawNo)=${latest}, known(max)=${maxKnown}`);

  const start = maxKnown > 0 ? maxKnown + 1 : 1;
  if (start > latest) {
    console.log("[lotto] nothing to update.");
    return;
  }

  // 최초 실행이면 1~latest까지 대량 수집
  const fetched = await fetchRange(start, latest, 4);
  for (const d of fetched) map.set(d.drwNo, d);

  const merged = Array.from(map.values()).sort((a, b) => a.drwNo - b.drwNo);
  safeWriteJson(DATA_PATH, merged);

  const newest = merged[merged.length - 1];
  console.log(`[lotto] updated. total=${merged.length}, newest=${newest?.drwNo} (${newest?.drwNoDate})`);
}

main().catch((e) => {
  console.error("[lotto] update failed:", e);
  process.exit(1);
});
