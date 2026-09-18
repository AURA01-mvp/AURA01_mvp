// Verya AI brain — one function, several "actions".
// Runs on Google's Gemini API, which has a genuine no-card free tier
// (gemini-2.5-flash / gemini-2.5-flash-lite). Rate limits are real, though,
// which is exactly why every request must carry a valid Supabase session
// token below — without that, anyone who finds this URL could burn through
// your whole daily free quota without ever signing up.

const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// flash-lite has the highest free-tier request ceiling, which matters here
// because Panel mode alone fires 3 calls per chat message. Swap to
// "gemini-2.5-flash" via the GEMINI_MODEL env var for higher quality if
// your quota allows it — check your live limits at
// https://aistudio.google.com/app/apikey (rate limits aren't fixed numbers
// Google publishes; they vary by account and change over time).
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const ALLOWED_ORIGIN = process.env.SITE_URL || "*";
const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });
  if (!process.env.GEMINI_API_KEY) return respond(500, { error: "Server is missing GEMINI_API_KEY." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return respond(500, { error: "Server is missing SUPABASE_URL / SUPABASE_ANON_KEY." });
  }

  // ---- verify the caller is a real signed-in user ----
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return respond(401, { error: "Not signed in." });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return respond(401, { error: "Session expired. Please sign in again." });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return respond(400, { error: "Invalid JSON body" }); }
  const { action, payload } = body;
  if (!action) return respond(400, { error: "Missing 'action'" });

  try {
    switch (action) {
      case "onboarding_next": return respond(200, await onboardingNext(payload));
      case "generate_plan": return respond(200, await generatePlan(payload));
      case "daily_recommendation": return respond(200, await dailyRecommendation(payload));
      case "chat": return respond(200, await chat(payload));
      case "project_feedback": return respond(200, await projectFeedback(payload));
      case "verify_understanding": return respond(200, await verifyUnderstanding(payload));
      case "generate_review_questions": return respond(200, await generateReviewQuestions(payload));
      case "grade_recall": return respond(200, await gradeRecall(payload));
      case "growth_digest": return respond(200, await growthDigest(payload));
      default: return respond(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error("ai.js error:", err);
    const msg = String(err.message || err);
    const rateLimited = msg.includes("429") || /rate.?limit/i.test(msg);
    return respond(502, {
      error: rateLimited
        ? "Hit Gemini's free-tier rate limit. Wait a minute and try again."
        : "The AI brain hiccuped. Please try again.",
      detail: msg,
    });
  }
};

function respond(statusCode, obj) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(obj) };
}

// Gemini uses role "model" for the assistant turn, not "assistant".
function toContents(history = [], newMessage) {
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  if (newMessage) contents.push({ role: "user", parts: [{ text: newMessage }] });
  return contents;
}

async function generate({ systemInstruction, contents, maxOutputTokens = 1000 }) {
  const resp = await genAI.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction, maxOutputTokens },
  });
  return (resp.text || "").trim();
}

async function askForJSON(systemInstruction, userPrompt, fallback, maxOutputTokens = 1000) {
  const text = await generate({ systemInstruction, contents: userPrompt, maxOutputTokens });
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); }
  catch (e) { console.error("JSON parse failed:", text); return typeof fallback === "function" ? fallback(text) : fallback; }
}

// ---------------- ONBOARDING / PLAN / DAILY REC ----------------

async function onboardingNext({ history = [], profile = {} } = {}) {
  const system = `You are the onboarding intelligence for Verya, a premium AI mentor and career-operating-system product.
Work out who this person is and what they want through a short adaptive conversation (6-9 questions total).
Rules:
- Work for ANY field or ambition — never assume a specific domain, course, or fixed timeline.
- Ask exactly ONE question at a time, the single most useful next question.
- Always free-text friendly; you may suggest up to 4 short quick-reply options.
- You need, by the end: name, background, what they're trying to achieve, roughly how many hours per week they have, and any deadline pressure.
- Once you have enough, stop and return the "done" summary.
Respond ONLY with strict JSON, no markdown fences, matching exactly one shape:
{"type":"question","question":"...","quick_replies":["...","..."]}
{"type":"done","profile":{"name":"...","background":"...","goal":"...","domain":"...","weekly_hours":number,"timeframe_hint_weeks":number|null,"summary":"one sentence recap"}}`;
  const user = `Conversation so far:\n${history.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`).join("\n") || "(none yet)"}\n\nKnown fragments: ${JSON.stringify(profile)}\n\nReturn the next step now.`;
  return askForJSON(system, user, { type: "question", question: "Could you tell me a bit more about what you're trying to achieve?", quick_replies: [] });
}

async function generatePlan({ profile = {}, timeframe_weeks } = {}) {
  const system = `You are Verya's planning engine. Given a goal, background, and available time, produce a concrete milestone plan for ANY field. Be specific, never generic.
Respond ONLY with strict JSON: {"milestones":[{"title":"...","description":"...","week_target":number}],"summary":"..."}
Produce 4-10 milestones spaced across the timeframe.`;
  const user = `Profile: ${JSON.stringify(profile)}\nTimeframe: ${timeframe_weeks} weeks.\nBuild the plan now.`;
  return askForJSON(system, user, { milestones: [{ title: "Define the concrete first deliverable", description: "Break the goal into one small deliverable.", week_target: 1 }], summary: "A starter plan." });
}

async function dailyRecommendation({ profile = {}, goal = {}, minutes_available, recent_work = [] } = {}) {
  const system = `You are Verya's daily mentor. Given a goal, plan, recent work, and available time RIGHT NOW, name the single highest-impact thing to do. Be concrete, never generic.
Respond ONLY with strict JSON: {"action":"...","why":"...","next":"..."}`;
  const user = `Profile: ${JSON.stringify(profile)}\nGoal: ${JSON.stringify(goal)}\nRecent work: ${JSON.stringify(recent_work)}\nMinutes available: ${minutes_available}\nGive today's recommendation.`;
  return askForJSON(system, user, { action: "Spend this window on the next open milestone.", why: "Direct progress on the next milestone is the safest high-impact move.", next: "Log what you did afterward." });
}

// ---------------- MENTOR CHAT: direct / socratic / panel ----------------

async function chat({ message, history = [], profile = {}, goal = {}, mode = "direct" } = {}) {
  if (mode === "panel") return panelChat({ message, history, profile, goal });

  const base = `You know this person's profile and goal (below). Be specific to their real situation, never generic.
Profile: ${JSON.stringify(profile)}
Current goal: ${JSON.stringify(goal)}`;

  const system = mode === "socratic"
    ? `You are the Verya mentor in SOCRATIC mode. Your job is to make the person think, not to think for them.
Rules:
- NEVER give the direct answer or finished solution, even if asked.
- Respond with ONE sharp question that moves their thinking forward, plus at most one sentence of framing.
- If they're stuck, narrow the question rather than answering it.
- If they explicitly want a direct answer, tell them briefly they can switch to Direct mode with the toggle above the chat — don't just cave.
${base}`
    : `You are the Verya mentor — direct, honest, specific. Give real critique when warranted, not just encouragement. A few short paragraphs at most.
${base}`;

  const contents = toContents(history.slice(-10), message);
  const text = await generate({ systemInstruction: system, contents, maxOutputTokens: 800 });
  return { reply: text || "I didn't quite catch that — could you rephrase?", mode };
}

// Three personas answer the same message, so the user weighs perspectives
// instead of accepting one voice as "the" answer.
async function panelChat({ message, history = [], profile = {}, goal = {} } = {}) {
  const personas = [
    { label: "The Pragmatist", voice: "Focus entirely on what's practical and actionable this week. Distrust the abstract. Be terse." },
    { label: "The Skeptic", voice: "Stress-test the idea. Find the weakest assumption and push on it. Direct, not unkind." },
    { label: "The Visionary", voice: "Zoom out to long-term trajectory and what this compounds into in a year or five. Ambitious but grounded." },
  ];
  const contents = toContents(history.slice(-6), message);

  const results = await Promise.all(personas.map(async (p) => {
    const system = `You are "${p.label}", one voice on a panel of three mentors advising this person. ${p.voice}
Profile: ${JSON.stringify(profile)}
Goal: ${JSON.stringify(goal)}
Keep your reply to 2-4 sentences — you are one voice among three, not the whole answer.`;
    const text = await generate({ systemInstruction: system, contents, maxOutputTokens: 300 });
    return { persona: p.label, reply: text };
  }));
  return { panel: results, mode: "panel" };
}

// ---------------- PROJECT FEEDBACK ----------------

async function projectFeedback({ entry, profile = {}, goal = {} } = {}) {
  const system = `You are Verya's project reviewer. Give short, specific, honest feedback and 2-4 concrete next steps on ANY kind of work.
Respond ONLY with strict JSON: {"feedback":"...","suggestions":["...","..."]}`;
  const user = `Profile: ${JSON.stringify(profile)}\nGoal: ${JSON.stringify(goal)}\nEntry: ${entry}`;
  return askForJSON(system, user, { feedback: "Logged.", suggestions: ["Note one blocker.", "Note the next concrete step."] });
}

// ---------------- UNDERSTANDING CHECK (Feynman gate) ----------------

async function verifyUnderstanding({ milestone = {}, explanation, profile = {} } = {}) {
  const system = `You are Verya's understanding check. Someone claims to have completed a milestone and explained it in their own words.
Judge honestly: does the explanation show real understanding (specific, in their own words, only writable by someone who did the work) — or is it vague enough to have been written without doing it?
Be a fair judge, not a harsh gatekeeper — short but specific should pass.
Respond ONLY with strict JSON: {"sufficient": true|false, "feedback": "one or two honest, specific sentences"}`;
  const user = `Milestone: ${JSON.stringify(milestone)}\nTheir explanation: ${explanation}\nProfile: ${JSON.stringify(profile)}`;
  return askForJSON(system, user, { sufficient: true, feedback: "Logged — Verya couldn't evaluate this one, so it's trusting you." });
}

// ---------------- SPACED-REPETITION RECALL ----------------

async function generateReviewQuestions({ recent_entries = [], profile = {} } = {}) {
  const system = `You generate spaced-repetition recall questions from someone's OWN recent work — never generic trivia.
Write 3-6 short recall questions testing whether they still understand the specific things THEY did or learned — concepts, decisions, reasoning. No yes/no questions.
Respond ONLY with strict JSON: {"questions":[{"question":"...","answer_hint":"short hint of what a good answer touches on, not the full answer"}]}`;
  const user = `Recent work-log entries: ${JSON.stringify(recent_entries)}\nProfile: ${JSON.stringify(profile)}`;
  return askForJSON(system, user, { questions: [] });
}

async function gradeRecall({ question, answer_hint, user_answer } = {}) {
  const system = `You grade a recall answer honestly and kindly. The person is testing their own memory of their own work.
Respond ONLY with strict JSON: {"verdict":"strong"|"partial"|"weak","feedback":"1-2 specific sentences on what they got right and what they missed"}`;
  const user = `Question: ${question}\nWhat a good answer touches on: ${answer_hint}\nTheir answer: ${user_answer}`;
  return askForJSON(system, user, { verdict: "partial", feedback: "Couldn't grade this one automatically — compare your answer to your original notes." });
}

// ---------------- WEEKLY GROWTH DIGEST ----------------

async function growthDigest({ work_log = [], milestones_done = [], profile = {}, goal = {} } = {}) {
  const system = `You write a short, honest weekly retrospective — a candid note from a mentor, not a cheerleading summary.
Respond ONLY with strict JSON: {"highlights":"2-3 sentences on real progress","honest_critique":"1-3 sentences of genuine specific critique","focus_next_week":"1-2 sentences on the single most important next focus"}`;
  const user = `Goal: ${JSON.stringify(goal)}\nProfile: ${JSON.stringify(profile)}\nWork log: ${JSON.stringify(work_log)}\nMilestones completed: ${JSON.stringify(milestones_done)}`;
  return askForJSON(system, user, { highlights: "Some entries logged this period.", honest_critique: "Not enough logged yet for sharp feedback — log more of your actual work.", focus_next_week: "Log work consistently so the next digest can be specific." });
}
