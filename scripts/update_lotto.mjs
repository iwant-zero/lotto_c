// scripts/update_lotto.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "lotto.json");

// ✅ 차단 잘 안 걸리는 공개 JSON 소스(미러)
const SOURCE_ALL = "https://smok95.github.io/lotto/results/all.json";

function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t) };
}

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// JSON이 앞뒤로 쓰레기 문자가 섞여도 최대한 복구
function safeParseJson(text) {
  const s = stripBOM(String(text ?? "")).trim();

  // 정상 JSON이면 바로 파싱
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    return JSON.parse(s);
  }

  // 앞뒤에 이상한 문자가 붙는 경우 대비(첫 {/[ 부터 마지막 }/] 까지)
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const first = (firstObj === -1) ? firstArr : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
  const lastObj = s.lastIndexOf("}");
  const lastArr = s.lastIndexOf("]");
  const last = Math.max(lastObj, lastArr);

  if (first >= 0 && last > first) {
    const slice = s.slice(first, last + 1);
    return JSON.parse(slice);
  }

  throw new Error(`Not JSON. head="${s.slice(0, 200).replace(/\s+/g, " ")}"`);
}

async function fetchJson(url) {
  const { signal, clear } = withTimeout(30_000);
  try {
    const res = await fetch(url, {
      signal,
      redirect: "follow",
      headers: {
        "User-Agent": "lotto-issueops/2.0 (github-actions)",
        "Accept": "application/json,text/plain,*/*",
      },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`[HTTP ${res.status}] head="${text.slice(0, 300).replace(/\s+/g, " ")}"`);
    }

    try {
      return safeParseJson(text);
    } catch (e) {
      // JSON이 아닌 내용(HTML 등) 받으면 여기로
      throw new Error(
        `JSON parse failed.\nURL=${url}\nHEAD:\n${text.slice(0, 700)}\n---\n${String(e)}`
      );
    }
  } finally {
    clear();
  }
}

// smok95 포맷 -> 우리 포맷(동행복권 키 스타일)로 변환
function normalizeDraw(d) {
  // d 예: { draw_no: 1135, numbers:[...], bonus_no: 7, date:"2025-01-25T00:00:00Z" }
  if (!d || typeof d.draw_no !== "number") return null;
  if (!Array.isArray(d.numbers) || d.numbers.length < 6) return null;

  const nums = d.numbers.slice(0, 6).map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return null;

  const dateIso = typeof d.date === "string" ? d.date : "";
  const drwNoDate = dateIso.length >= 10 ? dateIso.slice(0, 10) : "";

  // numbers 정렬(안 되어 있어도 안정적으로)
  nums.sort((a, b) => a - b);

  return {
    drwNo: d.draw_no,
    drwNoDate,
    drwtNo1: nums[0],
    drwtNo2: nums[1],
    drwtNo3: nums[2],
    drwtNo4: nums[3],
    drwtNo5: nums[4],
    drwtNo6: nums[5],
    bnusNo: Number(d.bonus_no ?? 0),
    source: "smok95.github.io/lotto",
  };
}

async function main() {
  await fs.mkdir(path.join(ROOT, "data"), { recursive: true });

  console.log("[lotto] fetching:", SOURCE_ALL);
  const all = await fetchJson(SOURCE_ALL);

  if (!Array.isArray(all) || all.length === 0) {
    throw new Error("SOURCE_ALL returned empty array.");
  }

  const normalized = all
    .map(normalizeDraw)
    .filter(Boolean)
    .sort((a, b) => a.drwNo - b.drwNo);

  if (normalized.length === 0) {
    throw new Error("No valid draws after normalization.");
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(normalized, null, 2) + "\n", "utf8");

  const last = normalized[normalized.length - 1];
  console.log(`[lotto] updated: total=${normalized.length}, last=${last.drwNo} (${last.drwNoDate})`);
}

main().catch((err) => {
  console.error("[lotto] update failed:", err?.stack || String(err));
  process.exit(1);
});
