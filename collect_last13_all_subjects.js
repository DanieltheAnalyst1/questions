// collect_last13_all_subjects.js
// Pull all subjects for the last 13 years for a given exam, save per-year and per-subject JSON,
// plus a combined file. Uses native fetch on Node 20+.

import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.myquest.com.ng/api/questions";
const API_KEY = process.env.MYQUEST_KEY;
if (!API_KEY) {
  console.error("Missing MYQUEST_KEY in env");
  process.exit(1);
}

// Inputs
const EXAM = process.env.EXAM || "JAMB";          // JAMB or POSTUTME or GST
const YEARS_BACK = parseInt(process.env.YEARS_BACK || "13", 10); // default 13
const POLITE_DELAY_MS = parseInt(process.env.POLITE_DELAY_MS || "150", 10); // wait between calls
const OUT_DIR = path.join("outputs", EXAM);

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function post(endpointQuery, bodyObj) {
  const url = endpointQuery ? `${API}?${endpointQuery}` : API;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyObj || {})
      });
      const text = await res.text(); // handle non JSON errors safely
      let data;
      try { data = JSON.parse(text); } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        const msg = data?.message || JSON.stringify(data);
        throw new Error(`HTTP ${res.status} ${msg}`);
      }
      return data;
    } catch (err) {
      const transient = String(err.message).includes("ECONNRESET") || String(err.message).includes("fetch failed") || String(err.message).includes("network");
      if (attempt < 4 && transient) {
        const backoff = 300 * attempt;
        console.warn(`Transient error, retry ${attempt}/3 after ${backoff}ms: ${err.message}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

// API calls per docs
async function getYears(exam) {
  const r = await post("get=exam_year_id", { exam });
  const years = Array.isArray(r?.data) ? r.data : [];
  // Ensure numeric sort desc, then take last N years from the top
  const sorted = years
    .map(y => String(y))
    .filter(y => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));
  return sorted.slice(0, YEARS_BACK);
}

async function getSubjects(exam, year) {
  const r = await post("get=subject", { exam, exam_year_id: String(year) });
  const subs = Array.isArray(r?.data) ? r.data : [];
  // Subject names are case and spacing sensitive. Use exactly what API returns.
  return subs;
}

async function getAllQuestions(exam, year, subject) {
  // Page until no more, store all
  const all = [];
  let page = 1;
  while (true) {
    const body = { exam, exam_year_id: String(year), subject, page };
    const r = await post("", body);
    const pkg = r?.data || {};
    const qs = Array.isArray(pkg?.questions) ? pkg.questions : [];
    if (qs.length === 0) break;

    // Tag each question with metadata
    for (const q of qs) {
      all.push({
        exam,
        year: String(year),
        subject,
        ...q
      });
    }

    // Pagination info
    const pg = pkg?.pagination || {};
    const current = Number(pg.current_page || page);
    const totalPages = Number(pg.total_pages || 1);

    if (current >= totalPages) break;
    page = current + 1;
    await sleep(POLITE_DELAY_MS);
  }
  return all;
}

function safeName(s) {
  return String(s)
    .replace(/\s+/g, "_")
    .replace(/[^\w\-\.]/g, "")
    .replace(/_+/g, "_");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJSON(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}

async function main() {
  console.log(`Starting last-${YEARS_BACK}-years collection for ${EXAM}`);
  console.log(`POLITE_DELAY_MS=${POLITE_DELAY_MS}`);

  await ensureDir(OUT_DIR);

  // Confirm exam exists
  const examsResp = await post("get=exam", {});
  const examList = examsResp?.data || [];
  if (!examList.includes(EXAM)) {
    console.error(`Exam ${EXAM} not in available list: ${examList.join(", ")}`);
    process.exit(1);
  }
  console.log(`Available exams: ${examList.join(", ")}`);

  // Years
  const years = await getYears(EXAM);
  if (years.length === 0) {
    console.error("No years discovered, cannot continue");
    process.exit(1);
  }
  console.log(`Years selected: ${years.join(", ")}`);

  const combined = [];
  const summary = [];

  for (const year of years) {
    console.log(`\nYear ${year}: discovering subjects...`);
    let subjects = [];
    try {
      subjects = await getSubjects(EXAM, year);
    } catch (e) {
      console.warn(`Failed to get subjects for ${year}: ${e.message}`);
      continue;
    }
    console.log(`Subjects (${subjects.length}): ${subjects.join(", ")}`);

    for (const subject of subjects) {
      console.log(`Fetching ${EXAM} ${year} ${subject}...`);
      try {
        const items = await getAllQuestions(EXAM, year, subject);
        const subDir = path.join(OUT_DIR, String(year));
        const file = path.join(subDir, `${safeName(subject)}.json`);
        await writeJSON(file, items);
        combined.push(...items);
        summary.push({ year, subject, count: items.length });
        console.log(`Saved ${items.length} items to ${file}`);
      } catch (e) {
        console.warn(`Failed ${EXAM} ${year} ${subject}: ${e.message}`);
      }
      await sleep(POLITE_DELAY_MS);
    }
  }

  // Write combined and summary
  const combinedFile = path.join(OUT_DIR, `exam_${EXAM}_last${YEARS_BACK}years.json`);
  await writeJSON(combinedFile, combined);
  const summaryFile = path.join(OUT_DIR, `summary_last${YEARS_BACK}years.json`);
  await writeJSON(summaryFile, { exam: EXAM, years, total: combined.length, bySubjectYear: summary });

  console.log(`\nDone. Total collected: ${combined.length}`);
  console.log(`Combined: ${combinedFile}`);
  console.log(`Summary: ${summaryFile}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
