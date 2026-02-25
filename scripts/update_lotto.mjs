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

async function fetchJson(url) {
  const { signal, clear } = withTimeout(30_000);
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "lotto-issueops/1.0 (+github actions)",
        "Accept": "application/json,text/plain,*/*",
      },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`[HTTP ${res.status}] ${text.slice(0, 300)}`);
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      // JSON이 아닌 내용(HTML 등) 받으면 여기로 떨어짐
      throw new Error(
        `JSON parse failed. Head:\n${text.slice(0, 500)}\n---\n${String(e)}`
      );
    }
  } finally {
    clear();
  }
}

// smok95 포맷 -> 우리 포맷(동행복권 키 스타일)로 변환
function normalizeDraw(d) {
  // d: { draw_no, numbers:[6], bonus_no, date:"2020-09-19T00:00:00Z", ... }
  if (!d || typeof d.draw_no !== "number") return null;
  if (!Array.isArray(d.numbers) || d.numbers.length < 6) return null;

  const nums = d.numbers.slice(0, 6).map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return null;

  const dateIso = typeof d.date === "string" ? d.date : "";
  const drwNoDate = dateIso.length >= 10 ? dateIso.slice(0, 10) : "";

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
    // 투명성(원하면 유지)
    source: "smok95.github.io/lotto",
  };
}

async function main() {
  await fs.mkdir(path.join(ROOT, "data"), { recursive: true });

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

  await fs.writeFile(OUT_PATH, JSON.stringify(normalized, null, 2), "utf8");

  const last = normalized[normalized.length - 1];
  console.log(
    `[lotto] updated: ${normalized.length} draws (last: ${last.drwNo} / ${last.drwNoDate})`
  );
}

main().catch((err) => {
  console.error("[lotto] update failed:", err);
  process.exit(1);
});
