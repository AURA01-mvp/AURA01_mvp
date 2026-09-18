# Verya — MVP

An AI mentor and career-operating-system product. Works for any field the
user is pursuing — the AI brain never assumes a specific domain.

**This is a real, working MVP**: real auth, real per-user database with
row-level security, and a real AI brain — not a mockup. You need two free
accounts (Supabase, Google AI Studio) and a Netlify account to run it live —
and the AI brain runs on Google's genuinely free Gemini API tier, no card
required.

A note on the name: "Verya" passed a few quick sanity checks (no obvious
existing software product with that name) but that is not a substitute for
a real trademark/domain search — do that before you commit to it publicly.

---

> **New to this? Read `SETUP-GUIDE.md` instead** — it's the same setup written
> step by step for a complete beginner, with screenshots-level detail.

## What's included

- `public/` — the entire frontend (plain HTML/CSS/JS, no build step, so
  nothing can break in a bundler)
  - `index.html` — marketing landing page
  - `auth.html` — sign up / sign in
  - `onboarding.html` — dynamic, AI-driven onboarding (works for any goal)
  - `dashboard.html` + `js/dashboard.js` — the product: Today (time-aware
    recommendation), Plan (milestones + understanding checks), Mentor
    (three chat modes), Work Log (feedback), Recall (spaced repetition),
    Digest (honest weekly retrospective)
- `netlify/functions/ai.js` — the one serverless function that holds your
  Gemini API key server-side and powers every AI feature
- `supabase/schema.sql` — the entire database schema + row-level security
  policies + the trigger that provisions a profile row on signup

## Architecture, in one paragraph

Netlify hosts the static frontend and one serverless function. The
frontend talks to Supabase directly for auth and data (protected by Row
Level Security, so users can only ever see their own rows) and talks to
the Netlify function for anything that needs the Gemini API key kept
secret. No other backend, no other moving parts.

---

## Setup (about 15 minutes)

### 1. Supabase (auth + database)
1. Create a free project at supabase.com.
2. Go to **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and run it.
3. Go to **Authentication → Providers → Email** and make sure Email is
   enabled. "Confirm email" is on by default — Supabase sends the
   confirmation email automatically, no extra setup needed.
4. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.
5. Open `public/js/config.js` and paste those two values in.

### 2. Google AI Studio (the AI brain — free, no card)
1. Get a free API key at aistudio.google.com → **Get API key**.
2. You'll set it as a Netlify environment variable in step 3 below — never
   put it in any frontend file. This runs on Gemini's free tier
   (`gemini-2.5-flash-lite` by default), so there's nothing to pay.

### 3. Netlify (hosting)
1. Push this folder to a GitHub repo (or use the Netlify CLI to deploy
   directly from disk with `netlify deploy`).
2. In Netlify: **Add new site → Import from Git**, pick the repo. Build
   settings are already defined in `netlify.toml` (publish dir `public`,
   functions dir `netlify/functions`) — you shouldn't need to change
   anything.
3. Go to **Site settings → Environment variables** and add:
   - `GEMINI_API_KEY` = your key from step 2
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon key
   - `SITE_URL` = your Netlify site URL (locks CORS to your own site)
   - (optional) `GEMINI_MODEL` = `gemini-2.5-flash-lite` (the default — swap
     to `gemini-2.5-flash` for higher quality if your quota allows it)

   The function needs the Supabase keys because it verifies the caller is a
   signed-in user before burning through your free daily Gemini quota.
4. Deploy.

### 4. Try it
Visit your Netlify URL → Sign up → confirm the email Supabase sent you →
sign in → onboarding (answer honestly, it adapts) → dashboard.

---

## What's deliberately NOT in this MVP

Kept out on purpose to keep the workflow bulletproof for a first demo:

- Password reset flow (Supabase supports it — a few lines to wire up when
  you need it)
- Payments/subscriptions
- Multi-goal analytics or team/cohort features
- Push notifications / email nudges for the daily recommendation

## If something breaks

- **"Server is missing GEMINI_API_KEY"** — you forgot step 3.3, or the
  env var name has a typo. Redeploy after adding it (env var changes need
  a new deploy to take effect).
- **"Hit Gemini's free-tier rate limit"** — normal on a free key under
  heavy testing (e.g. Panel mode fires 3 calls per message). Wait a
  minute and retry.
- **Sign-up works but nothing happens after confirming the email** — check
  Supabase → Authentication → URL Configuration → make sure your Netlify
  site's URL is in the allowed redirect list.
- **"row-level security" errors in the browser console** — you skipped
  running `schema.sql`, or ran it against the wrong project.


---

## The features that make this different

Most AI study/career tools optimise for giving you answers fast. Verya
deliberately does the opposite in places, because a tool that thinks *for*
you erodes the thing you're trying to build.

**1. Socratic mode** — a mentor mode that will not give you the answer. It
asks the question that gets you there yourself, and won't cave if you push.
(Direct mode is one tap away when you genuinely just need the answer.)

**2. Panel mode** — three mentors with deliberately different biases (a
Pragmatist, a Skeptic, a Visionary) answer the same question at once, then
ask you which you agree with. You can't outsource judgement to a
disagreeing committee.

**3. Understanding checks** — you can't tick a milestone complete by just
clicking. You explain what you did in your own words, and the AI judges
whether that explanation could only have been written by someone who
actually did it. (Skippable, because gatekeeping someone out of their own
plan would be worse.)

**4. Recall practice on your own work** — not generic flashcards. Verya
turns *your* work log into recall questions and resurfaces them on a
spacing schedule. Answer from memory, get graded honestly, and the interval
adapts: strong answers push further out, weak ones come back tomorrow.

**5. Honest weekly digest** — a retrospective that includes genuine
critique, not just encouragement. Most products flatter you into staying.

### On engagement

This is built to be worth returning to, not engineered to be compulsive.
There are no manufactured streaks, no guilt notifications, no variable
reward loops. Those mechanics are the same ones behind the attention
problems this product is meant to help with, and building them in would
undermine the whole premise. Returning users should come back because the
recall queue genuinely helps them remember and the digest genuinely tells
them something true.

## Security

- Gemini key lives only in Netlify env vars, never in frontend code
- The AI function rejects any request without a valid Supabase session
  token — strangers can't find the URL and burn through your free quota
- Row Level Security on every table: users can only ever read/write rows
  where `auth.uid()` matches
- CORS locked to `SITE_URL`; CSP, HSTS, X-Frame-Options, and
  nosniff headers set in `netlify.toml`
- All user-supplied text is escaped before rendering (no XSS via a work-log
  entry or a goal title)
