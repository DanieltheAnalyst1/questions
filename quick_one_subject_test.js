const API_KEY = process.env.MYQUEST_KEY;

async function fetchQuestions() {
  const res = await fetch("https://api.myquest.com.ng/api/questions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      exam: "POSTUTME",
      exam_year_id: "2024",
      subject: "Mathematics" // exact case-sensitive name
    })
  });

  const data = await res.json();
  console.log("STATUS:", res.status);
  console.log(JSON.stringify(data, null, 2));
}

fetchQuestions().catch(console.error);
