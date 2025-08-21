// test_myquest.js - robust, prints raw responses or errors
const KEY = process.env.MYQUEST_KEY || "bef533ceb2ef5e925e943d8f964b2190d05f308d8282e9b7ad1298182b9ca4fe";
const API = "https://api.myquest.com.ng/api/questions";

async function post(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    console.log("URL:", url);
    console.log("STATUS:", res.status);
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch(e) { console.log(text); }
  } catch (err) {
    console.error("FETCH ERROR for", url);
    if (err && err.stack) console.error(err.stack);
    else console.error(err);
  }
  console.log("----");
}

(async () => {
  await post(`${API}?get=exam`, {});
  await post(`${API}?get=exam_year_id`, { exam: "JAMB" });
  await post(`${API}?get=subject`, { exam: "JAMB", exam_year_id: "2024" });
  await post(`${API}`, { exam: "JAMB", exam_year_id: 2024, subject: "government", page: 1 });
})();
