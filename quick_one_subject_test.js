// quick_one_subject_test.js
const KEY = process.env.MYQUEST_KEY || "bef533ceb2ef5e925e943d8f964b2190d05f308d8282e9b7ad1298182b9ca4fe";
const API = "https://api.myquest.com.ng/api/questions";
(async () => {
  const body = { exam: "JAMB", exam_year_id: 2024, subject: "Government", page: 1 };
  try {
    const r = await fetch(API, { method: "POST", headers: { "Authorization": `Bearer ${KEY}`, "Content-Type":"application/json" }, body: JSON.stringify(body) });
    console.log("STATUS:", r.status);
    console.log(await r.text());
  } catch (e) { console.error(e); }
})();
