// collect_exam.js
// Node 18+ required
import fs from "fs";
import path from "path";

const API_BASE = "https://api.myquest.com.ng/api/questions";
const KEY = process.env.MYQUEST_KEY;
if (!KEY) {
  console.error("Missing API key. Set MYQUEST_KEY and re-run.");
  process.exit(1);
}

const EXAM = (process.env.EXAM || "JAMB").toString();
const PER_SUBJECT_TARGET = process.env.PER_SUBJECT_TARGET ? parseInt(process.env.PER_SUBJECT_TARGET, 10) : null;
const TARGET = process.env.TARGET ? parseInt(process.env.TARGET, 10) : null;
if (!PER_SUBJECT_TARGET && !TARGET) {
  console.error("Set either PER_SUBJECT_TARGET or TARGET. For example PER_SUBJECT_TARGET=1000");
  process.exit(1);
}

const POLITE_DELAY_MS = process.env.POLITE_DELAY_MS ? parseInt(process.env.POLITE_DELAY_MS, 10) : 150;
const CHECKPOINT_PAGES = process.env.CHECKPOINT_PAGES ? parseInt(process.env.CHECKPOINT_PAGES, 10) : 40;

const OUT_DIR = path.join(process.cwd(), "outputs", EXAM);
const SUBJECTS_DIR = path.join(OUT_DIR, "subjects");
const CHECKPOINT_FILE = path.join(process.cwd(), `checkpoint_${EXAM}.json`);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(SUBJECTS_DIR)) fs.mkdirSync(SUBJECTS_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function postWithGet(getQuery, body = {}) {
  const url = `${API_BASE}?get=${encodeURIComponent(getQuery)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { rawText: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return json;
}

async function postQuestions(body = {}) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { rawText: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return json;
}

function norm(s = "") {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 1000);
}

function saveCheckpoint(obj) {
  try { fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(obj, null, 2), "utf8"); } catch (e) { console.warn("Checkpoint write failed", e.message); }
}

function writeOutputs(allItems, perSubjectMap) {
  const examFile = path.join(OUT_DIR, `exam_${EXAM}.json`);
  fs.writeFileSync(examFile, JSON.stringify(allItems, null, 2), "utf8");

  const csvFile = path.join(OUT_DIR, `exam_${EXAM}.csv`);
  const safe = v => {
    if (v === undefined || v === null) return "";
    let s = String(v).replace(/[\r\n]+/g, " ");
    if (s.includes('"')) s = `"${s.replace(/"/g, '""')}"`;
    else if (s.includes(",") || s.includes("\n")) s = `"${s}"`;
    return s;
  };
  const header = ["source_id","exam","source_year","source_subject","question","options","answer","explanation","fetched_page"];
  const lines = [header.join(",")];
  for (const q of allItems) {
    lines.push([
      safe(q.id ?? ""),
      safe(q._source_exam ?? EXAM),
      safe(q._source_year ?? ""),
      safe(q._source_subject ?? ""),
      safe(q.question_text ?? q.question ?? ""),
      safe(q.options ? JSON.stringify(q.options) : ""),
      safe(q.correct_answer ?? q.answer ?? ""),
      safe(q.explanation ?? ""),
      safe(q._fetched_page ?? "")
    ].join(","));
  }
  fs.writeFileSync(csvFile, lines.join("\n"), "utf8");
  console.log(`Wrote ${examFile} (${allItems.length}) and ${csvFile}`);

  // write per-subject files
  for (const s of Object.keys(perSubjectMap)) {
    const filename = path.join(SUBJECTS_DIR, `${s.replace(/[^a-z0-9_\\-]/gi, "_")}.json`);
    fs.writeFileSync(filename, JSON.stringify(perSubjectMap[s], null, 2), "utf8");
  }
  // write summary
  const summary = {
    exam: EXAM,
    total_collected: allItems.length,
    subjects: Object.fromEntries(Object.keys(perSubjectMap).map(k => [k, perSubjectMap[k].length]))
  };
  fs.writeFileSync(path.join(OUT_DIR, `summary_${EXAM}.json`), JSON.stringify(summary, null, 2), "utf8");
  console.log("Wrote per-subject files and summary");
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); } catch (e) { console.warn("Could not parse checkpoint file, ignoring it.", e.message); return null; }
}

async function discoverExams() {
  try {
    const r = await postWithGet("exam", {});
    const arr = (r && (r.data ?? r.exams ?? r)) || [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (err) {
    console.warn("discoverExams error, response not usable:", err.message);
    return [];
  }
}

async function discoverYears() {
  try {
    const r = await postWithGet("exam_year_id", { exam: EXAM });
    const arr = (r && (r.data ?? r.exam_years ?? r.years ?? r)) || [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (err) {
    console.warn("discoverYears error, response not usable:", err.message);
    return [];
  }
}

async function discoverSubjectsForYear(year) {
  try {
    const r = await postWithGet("subject", { exam: EXAM, exam_year_id: String(year) });
    const arr = (r && (r.data ?? r.subjects ?? r)) || [];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    // log quietly and return empty array
    console.warn(`discoverSubjectsForYear(${year}) error:`, err.message);
    return [];
  }
}

// Try several subject slug variants and return the first non-empty result
async function trySubjectVariants(exam, year, subject, page) {
  const variants = [];
  const raw = String(subject);
  variants.push(raw); // as-is
  variants.push(raw.toLowerCase());
  variants.push(raw.replace(/\s+/g,"-").toLowerCase());
  variants.push(raw.replace(/\s+/g,"_").toLowerCase());
  variants.push(raw.replace(/[^\w\s-]/g,"").toLowerCase()); // remove punctuation
  variants.push(raw.replace(/[\s\._]+/g,"-").toLowerCase());
  // unique
  const uniq = Array.from(new Set(variants));
  for (const sVar of uniq) {
    try {
      const r = await postQuestions({ exam, exam_year_id: String(year), subject: sVar, page });
      const qs = (r && (r.data?.questions ?? r.questions ?? r.data ?? r)) || [];
      if (Array.isArray(qs) && qs.length > 0) {
        if (sVar !== raw) console.log(`Subject variant matched: "${raw}" -> "${sVar}" for year ${year} page ${page}`);
        return { qs, usedVariant: sVar };
      }
    } catch (e) {
      // if it returns 404 or not found, skip quietly
      const msg = String(e.message || "");
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) continue;
      // otherwise log and continue trying variants
      console.warn(`Error trying variant "${sVar}" for ${exam}/${year}/${raw} p${page}:`, msg);
    }
    // polite delay between variant attempts to avoid rate limits
    await sleep(80);
  }
  return { qs: [], usedVariant: null };
}

async function fetchQuestionsFor(exam, year, subject, page = 1) {
  // uses variant trial internally
  try {
    const { qs, usedVariant } = await trySubjectVariants(exam, year, subject, page);
    return { questions: qs, usedVariant };
  } catch (err) {
    console.warn(`fetchQuestions ${exam} ${year} ${subject} p${page} error`, err.message);
    return { questions: [], usedVariant: null };
  }
}

async function main() {
  console.log(`Starting collection for ${EXAM}, PER_SUBJECT_TARGET ${PER_SUBJECT_TARGET ?? "not set"}, TARGET ${TARGET ?? "not set"}`);

  // verify exam exists
  const exams = await discoverExams();
  console.log("Available exams from API:", exams.join(", "));
  if (!exams.includes(EXAM)) {
    console.error(`Exam "${EXAM}" is not available from the API. Aborting.`);
    process.exit(1);
  }

  const checkpoint = loadCheckpoint();
  let state = checkpoint?.state ?? null;
  let collectedMap = {};
  if (checkpoint?.items && Array.isArray(checkpoint.items)) {
    for (const q of checkpoint.items) {
      const key = norm(q._source_subject ? `${q._source_subject}::${q.question_text ?? q.question ?? ""}` : (q.question_text ?? q.question ?? ""));
      collectedMap[key] = q;
    }
    console.log("Loaded", Object.keys(collectedMap).length, "items from checkpoint");
  }

  if (!state) {
    const years = await discoverYears();
    state = { years: Array.isArray(years) && years.length ? years : [] };
    if (!state.years.length) {
      console.warn("No years discovered for this exam, using fallback range 2024..2000 for discovery");
      state.years = ["2024","2023","2022","2021","2020","2019","2018","2017","2016","2015","2014","2013","2012","2011","2010","2009","2008","2007","2006","2005","2004","2003","2002","2001","2000"];
    } else {
      console.log("Discovered years:", state.years.join(", "));
    }

    const subjSet = new Set();
    for (const y of state.years) {
      const subs = await discoverSubjectsForYear(y);
      if (Array.isArray(subs) && subs.length) subs.forEach(s => subjSet.add(String(s)));
      await sleep(POLITE_DELAY_MS);
    }
    state.subjects = Array.from(subjSet).sort();
    if (!state.subjects.length) {
      console.warn("No subjects discovered, using fallback subjects list");
      state.subjects = ["mathematics","english","physics","chemistry","biology"];
    } else console.log("Discovered subjects (sample):", state.subjects.slice(0,20).join(", "));
    state.ptr = {};
    for (const s of state.subjects) state.ptr[s] = { yearIndex: 0, page: 1, collected: 0, exhausted: false };
    saveCheckpoint({ state, items: Object.values(collectedMap), pagesFetched: 0 });
    console.log("Initial checkpoint saved");
  } else {
    state.years = Array.isArray(state.years) ? state.years : [];
    state.subjects = Array.isArray(state.subjects) ? state.subjects : [];
    state.ptr = state.ptr ?? {};
    for (const s of state.subjects) state.ptr[s] = state.ptr[s] ?? { yearIndex: 0, page: 1, collected: 0, exhausted: false };
    console.log("Resuming from checkpoint, subjects:", state.subjects.length, "years:", state.years.length);
  }

  const subjects = state.subjects;
  if (!Array.isArray(subjects) || subjects.length === 0) {
    console.error("No subjects available after discovery, aborting.");
    return;
  }

  const perSubTarget = PER_SUBJECT_TARGET ?? (TARGET ? Math.ceil(TARGET / subjects.length) : Math.ceil(10000 / subjects.length));
  console.log("Subjects count:", subjects.length, "per-subject target:", perSubTarget);

  let pagesFetched = checkpoint?.pagesFetched ?? 0;
  let round = 0;
  while (true) {
    round += 1;
    let progress = false;
    console.log(`Round ${round}, total collected ${Object.keys(collectedMap).length}`);

    for (const subject of subjects) {
      const p = state.ptr[subject];
      if (!p || p.exhausted) continue;
      if ((p.collected || 0) >= perSubTarget) continue;

      while ((p.collected || 0) < perSubTarget && !p.exhausted) {
        if ((p.yearIndex || 0) >= state.years.length) { p.exhausted = true; break; }
        const year = state.years[p.yearIndex];
        const page = p.page || 1;
        const { questions: qs, usedVariant } = await fetchQuestionsFor(EXAM, year, subject, page);
        pagesFetched += 1;

        if (!Array.isArray(qs) || qs.length === 0) {
          // try next year
          p.yearIndex = (p.yearIndex || 0) + 1;
          p.page = 1;
          await sleep(POLITE_DELAY_MS);
          continue;
        }

        progress = true;
        for (const q of qs) {
          const key = norm(`${subject}::${q.question_text ?? q.question ?? ""}`);
          if (!collectedMap[key]) {
            const annotated = {
              ...q,
              _source_exam: EXAM,
              _source_year: String(year),
              _source_subject: subject,
              _fetched_page: page,
              _subject_variant_used: usedVariant ?? subject
            };
            collectedMap[key] = annotated;
            p.collected = (p.collected || 0) + 1;
          }
          if (p.collected >= perSubTarget) break;
        }

        p.page = (p.page || 1) + 1;
        await sleep(POLITE_DELAY_MS);

        if (pagesFetched % CHECKPOINT_PAGES === 0) {
          saveCheckpoint({ state, items: Object.values(collectedMap), pagesFetched });
          console.log("Checkpoint saved at pagesFetched =", pagesFetched);
        }
      } // end per-subject while
    } // end subjects for

    saveCheckpoint({ state, items: Object.values(collectedMap), pagesFetched });
    if (!progress) {
      console.log("No new questions found this round, stopping.");
      break;
    }

    const allReached = subjects.every(s => (state.ptr[s]?.collected || 0) >= perSubTarget || state.ptr[s]?.exhausted);
    if (allReached) {
      console.log("All subjects reached per-subject target or exhausted.");
      break;
    }
  } // end main while

  const all = Object.values(collectedMap);
  const perSubjectMap = {};
  for (const s of subjects) perSubjectMap[s] = [];
  for (const q of all) {
    const subj = q._source_subject ?? "unknown";
    if (!perSubjectMap[subj]) perSubjectMap[subj] = [];
    perSubjectMap[subj].push(q);
  }

  writeOutputs(all, perSubjectMap);
  saveCheckpoint({ state: { done: true, totalCollected: all.length }, items: all });
  console.log("Finished. Collected", all.length, "unique questions for", EXAM);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
