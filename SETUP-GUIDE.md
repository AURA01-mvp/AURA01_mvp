# Setting Up Verya — The Complete Beginner's Guide

No prior experience assumed. Follow these in order. Take your time.

---

## What you're actually building (read this first, it makes everything else make sense)

Three services, each doing one job:

| Service | Its job | Think of it as |
|---|---|---|
| **Netlify** | Puts your website on the internet | The building your shop is in |
| **Supabase** | Remembers users and their data | The filing cabinet in the back |
| **Google AI Studio (Gemini)** | The AI that thinks | The expert you hired — this one works for free |

Your website (the files in `public/`) is the shop front. When someone signs up, Netlify's website talks to Supabase. When someone asks the AI something, it talks to Google's Gemini API. That's the whole system.

**One rule that matters:** the Gemini key is *secret* — not because it costs money (it's free), but because anyone who gets it could burn through your daily free quota and lock you out of your own app. The Supabase "anon" key is *not* secret (it's designed to sit in public code). That's why they're handled differently below — don't swap them.

---

# PART 1 — Supabase (about 10 minutes)

## Step 1: Make an account
1. Go to **supabase.com**
2. Click **Start your project**
3. Sign in with GitHub (easiest) or email

## Step 2: Create your project
1. Click **New project**
2. **Name:** `verya` (anything you like)
3. **Database Password:** click *Generate a password* — then **copy it into a notes file and save it**. You won't need it for this setup, but if you lose it you can't get it back.
4. **Region:** pick the one closest to you (for India: Mumbai / `ap-south-1`)
5. **Plan:** Free
6. Click **Create new project**

☕ It takes 2–3 minutes to build. Wait for the green "Project is ready".

## Step 3: Create the database tables

This is the step people skip and then wonder why nothing works. Don't skip it.

1. In the left sidebar, click the **SQL Editor** icon (looks like a terminal/database icon)
2. Click **+ New query**
3. Open the file `supabase/schema.sql` from your Verya folder in any text editor
4. **Select all of it** (Ctrl+A / Cmd+A) and **copy** (Ctrl+C / Cmd+C)
5. **Paste** it into the big empty box in Supabase
6. Click the green **Run** button (bottom right), or press Ctrl+Enter

✅ **You should see:** "Success. No rows returned" — that's correct, that's what success looks like here.

❌ **If you see red errors:** you probably pasted only part of the file. Clear the box and paste the whole thing again.

**Check it worked:** click the **Table Editor** icon in the sidebar. You should see tables named `profiles`, `goals`, `time_logs`, `work_log`, `chat_messages`, `recall_cards`, `digests`. If they're there, you're done with this step.

## Step 4: Get your two keys
1. Click the **gear icon** (Project Settings) at the bottom of the sidebar
2. Click **API** in the settings menu
3. You'll see two things you need — copy both into your notes file:
   - **Project URL** — looks like `https://abcdefghijk.supabase.co`
   - **Project API keys → `anon` `public`** — a very long string starting with `eyJ...`

> ⚠️ There's also a `service_role` key on that page. **Never use it.** It bypasses all security. You don't need it for Verya.

## Step 5: Put those keys in your code
1. Open `public/js/config.js` in any text editor (Notepad, TextEdit, VS Code — anything)
2. You'll see this:
   ```js
   window.VERYA_CONFIG = {
     SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
     SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
   };
   ```
3. Replace the two placeholder strings with your real values. **Keep the quotes.**
4. Save the file.

✅ **Done with Supabase for now.** You'll come back in Part 3 for one last setting.

---

# PART 2 — Google AI Studio / Gemini (about 3 minutes, genuinely free)

1. Go to **aistudio.google.com**
2. Sign in with any Google account
3. Click **Get API key** in the left sidebar
4. Click **Create API key**, pick or create a project, and **copy the key**
5. Paste it into your notes file

No card, no billing setup, nothing to pay. This uses Gemini's free tier
(`gemini-2.5-flash-lite`), which is generous enough for solo testing and
demos.

> ⚠️ There are real rate limits on the free tier (Google doesn't publish
> fixed numbers — check yours anytime at aistudio.google.com/app/apikey).
> If you hit one while testing, wait a minute and try again.

> 🔒 This key goes into Netlify's settings in Part 3 — **never** into any file in the `public/` folder. Anything in `public/` is visible to the whole internet.

---

# PART 3 — Netlify (about 10 minutes)

## Step 1: Put your code on GitHub
If you've never used GitHub:
1. Sign up at **github.com**
2. Download **GitHub Desktop** (desktop.github.com) — it's the easy way, no commands needed
3. In GitHub Desktop: **File → Add Local Repository** → choose your `verya-mvp` folder
4. It'll say "this isn't a git repository — create one?" → click **create a repository**
5. Click **Publish repository**. **Uncheck "Keep this code private"** only if you're fine with it being public — either works, Netlify can read both.

## Step 2: Deploy
1. Go to **netlify.com**, sign up (use "Sign up with GitHub" — it makes the next step automatic)
2. Click **Add new site → Import an existing project**
3. Choose **GitHub**, authorize it, and pick your `verya-mvp` repository
4. **Don't change any build settings** — the `netlify.toml` file already configures everything correctly
5. Click **Deploy**

Your site is live in ~1 minute at a URL like `random-name-12345.netlify.app`. Copy that URL.

## Step 3: Add your secret keys to Netlify

The site is live but the AI won't work yet — it needs its keys.

1. In your Netlify site: **Site configuration → Environment variables**
2. Click **Add a variable → Add a single variable** for each of these four:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini key from Part 2 |
| `SUPABASE_URL` | your Supabase Project URL |
| `SUPABASE_ANON_KEY` | your Supabase anon key |
| `SITE_URL` | your Netlify URL, e.g. `https://random-name-12345.netlify.app` |

> Why does the server need the Supabase keys too? Because the AI function checks that whoever's calling it is actually signed in — otherwise strangers could find the URL and burn through your free Gemini quota before you even get to try it yourself.

3. **Important:** go to **Deploys → Trigger deploy → Deploy site**. Environment variables only take effect on a *new* deploy.

## Step 4: Tell Supabase about your site (the last step)

1. Back in Supabase: **Authentication → URL Configuration**
2. **Site URL:** paste your Netlify URL
3. **Redirect URLs:** click Add URL and paste your Netlify URL with `/**` at the end, e.g. `https://random-name-12345.netlify.app/**`
4. Save

Without this, the email confirmation link sends people to the wrong place.

---

# PART 4 — Test it end to end

Open your Netlify URL and do the full journey:

1. ✅ Landing page loads, dark theme
2. ✅ Click **Enter Verya** → sign up with a real email you can check
3. ✅ Check your inbox (**and spam**) → click the confirmation link
4. ✅ Sign in
5. ✅ Onboarding asks you questions that adapt to your answers
6. ✅ It builds a plan with real milestones
7. ✅ Dashboard: get a recommendation, chat with the mentor, try all three chat modes, log some work, build recall cards, generate a digest

**Test on your phone too** — open the same URL on Android/iPhone. Everything should be tappable and readable.

---

# Troubleshooting

**"Server is missing GEMINI_API_KEY"**
The env var isn't set, or you set it but didn't redeploy. Netlify → Deploys → Trigger deploy.

**"Hit Gemini's free-tier rate limit"**
You've hit the free tier's request cap for the moment. Wait a minute and
retry — this is normal on a free key, not a bug.

**"Not signed in" / kicked back to login repeatedly**
`SUPABASE_URL` or `SUPABASE_ANON_KEY` in Netlify's env vars don't match the ones in `config.js`. They must be the same project.

**Nothing happens after clicking the email confirmation link**
Part 3, Step 4 — the redirect URL isn't configured.

**Errors mentioning "row-level security" or "relation does not exist"**
You didn't run `schema.sql`, or ran it on a different project. Redo Part 1, Step 3.

**The confirmation email never arrives**
Check spam. Supabase's free built-in email is rate-limited (a few per hour) — fine for testing, and for real users you'd later connect a proper email service.

---

# The golden rules

1. **Never** put the Gemini key in the `public/` folder
2. **Never** use the Supabase `service_role` key in frontend code
3. After changing environment variables in Netlify, **always redeploy**
4. Keep your keys in a notes file somewhere safe
