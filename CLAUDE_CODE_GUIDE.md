# Stonefield BDM — Claude Code Guide

This service replaces the N8N workflow system entirely. It's a Node.js/TypeScript Express
service deployed on Railway, using Slack as the UI and Supabase as the database.

---

## Architecture

```
src/
  index.ts              — Express server + cron startup
  lib/
    env.ts              — All env vars, type-safe
    logger.ts           — Structured logger
    supabase.ts         — DB client + all typed query helpers
    claude.ts           — All Claude API calls + prompts
  slack/
    blocks.ts           — Every Slack card, modal, and debug view
    router.ts           — Action routing table + slash command routing
    webhook.ts          — Resend event webhook (WF5)
  jobs/
    cron.ts             — Scheduler (WF1/WF2/WF4 timings)
    wf1-scan.ts         — RSS fetch → score → post article cards
    wf2-threading.ts    — Narrative pitch generation
    wf4-send.ts         — Newsletter send via Resend
  handlers/
    wf1-tag.ts          — Add to Pool / Skip button handlers
    wf2-pitch.ts        — Pitch Approve / Reject / Hold handlers
    wf3a-blog.ts        — Blog generation + review handlers
    wf3b-outputs.ts     — Output kit generation + edit handlers
    slash.ts            — All slash command handlers
```

---

## Slack Action ID Map

Every button in Slack maps to a handler in `src/slack/router.ts`:

| action_id | Handler | What it does |
|---|---|---|
| `scbdm_tag_pool` | `handleTagPool` | Mark article pending, delete card |
| `scbdm_tag_skip` | `handleTagSkip` | Mark article rejected, delete card |
| `scbdm_pitch_approve` | `handlePitchApprove` | Approve pitch → triggers WF3a |
| `scbdm_pitch_reject` | `handlePitchReject` | Opens reject reason modal |
| `scbdm_pitch_hold` | `handlePitchHold` | Hold pitch, queue articles for next run |
| `scbdm_blog_approve` | `handleBlogApprove` | Approve blog → triggers WF3b |
| `scbdm_blog_feedback` | `handleBlogFeedback` | Opens feedback modal → regenerates |
| `scbdm_blog_edit` | `handleBlogEdit` | Opens direct edit modal |
| `scbdm_output_approve` | `handleOutputApprove` | Approve kit → saves to pending_sends |
| `scbdm_edit_snippet` | `handleEditSnippet` | Edit newsletter snippet modal |
| `scbdm_edit_linkedin` | `handleEditLinkedin` | Edit LinkedIn post modal |
| `scbdm_edit_brokerkit` | `handleEditBrokerKit` | Edit broker template modal |

Modal submissions route via `callback_id`:

| callback_id | Handler |
|---|---|
| `scbdm_pitch_reject_submit` | `handlePitchRejectSubmit` |
| `scbdm_blog_feedback_submit` | `handleBlogFeedbackSubmit` |
| `scbdm_blog_edit_submit` | `handleBlogEditSubmit` |
| `scbdm_edit_snippet_submit` | `handleEditSnippetSubmit` |

---

## Slash Commands

Register all of these in your Slack app settings → Slash Commands:

| Command | Handler | What it does |
|---|---|---|
| `/sc-status` | `handleSlashStatus` | Dashboard of all table counts |
| `/generateblog` | `handleSlashGenerateBlog` | Manually trigger WF2 |
| `/viewarticles` | `handleSlashViewArticles` | List pending article pool |
| `/runwf1` | `handleSlashRunWF1` | Manually trigger WF1 scan |
| `/scdebug` | `handleSlashDebug` | Debug tools (see below) |

### Debug Commands

```
/scdebug env              — Show env var status (no secrets exposed)
/scdebug db               — Test Supabase connection
/scdebug articles         — Dump top 10 pending articles
/scdebug pitch <uuid>     — Inspect a specific pitch row
/scdebug blog <uuid>      — Inspect a specific blog post row
```

---

## Cron Schedule

| Job | Schedule | ET time |
|---|---|---|
| WF1 — editorial scan | Mon–Fri 0 13 * * 1-5 UTC | 8:00am ET (EST) |
| WF2 — narrative threading | Mon & Wed 0 14 * * 1,3 UTC | 9:00am ET |
| WF4 — newsletter send | Tue & Thu 0 15 * * 2,4 UTC | 10:00am ET |

Adjust UTC offsets ±1hr in `src/jobs/cron.ts` when daylight saving changes.

---

## Workflow Flow

```
WF1 (daily scan)
  → RSS fetch → Claude scores → Supabase upsert
  → Post article card to #sc-newsletter-brief
  → [Add to Pool] or [Skip] button

WF2 (Mon/Wed or /generateblog)
  → Pull pending articles → pull pitch feedback
  → Claude generates 3-4 pitches by lens
  → Post pitch cards to #sc-newsletter-brief
  → [Generate Full Article] | [Use This Later] | [Not For Us]

WF3a (on pitch approve)
  → Pull pitch + articles + voice feedback
  → Claude writes full blog (800-1200 words)
  → Save to blog_posts (status: draft)
  → Post blog review card
  → [Looks Good] | [Give Feedback] | [Edit Directly]

WF3b (on blog approve)
  → Claude generates newsletter snippet, LinkedIn, broker template, AI prompt
  → Save to broker_kits table
  → Post output kit card
  → [Approve All & Schedule] | [Edit *] buttons

WF4 (Tue/Thu 10am)
  → Read pending_sends → A/B subject split
  → Resend batch to active brokers
  → Post confirmation to Slack

WF5 (Resend webhook → /webhook/resend)
  → Track opens, clicks, bounces, unsubscribes
  → Update brokers table
```

---

## Supabase Tables

All in project SC_BDM. One missing table to create:

```sql
-- broker_kits (not in original schema, added by WF3b)
create table broker_kits (
  id uuid primary key default gen_random_uuid(),
  blog_post_id uuid references blog_posts(id),
  newsletter_snippet text,
  linkedin_post text,
  broker_template text,
  broker_ai_prompt text,
  broker_ai_url text,
  updated_at timestamptz default now(),
  unique(blog_post_id)
);

-- email_events (for WF5 tracking)
create table email_events (
  id uuid primary key default gen_random_uuid(),
  sent_email_id uuid references pending_sends(id),
  broker_email text,
  event_type text,
  created_at timestamptz default now()
);
```

---

## Railway Deployment

1. Push repo to GitHub
2. Connect Railway to repo
3. Add all env vars from `.env.example` in Railway dashboard
4. Railway auto-deploys on push — `railway.toml` handles build + start

Slack app settings:
- **Interactivity & Shortcuts** → Request URL: `https://your-railway-url.up.railway.app/slack/actions`
- **Slash Commands** → each `/command` → same base URL + `/slack/commands`
- **OAuth Scopes**: `chat:write`, `chat:delete`, `commands`, `users:read`

---

## Adding Features

**New button in a card** → add `action_id` to `buildXxxCard()` in `blocks.ts`, add route in `router.ts`, add handler in the appropriate `handlers/` file.

**New cron job** → add job file in `jobs/`, import and schedule in `cron.ts`.

**New Claude prompt** → add function to `claude.ts`, import where needed.

**New slash command** → add handler in `handlers/slash.ts`, register in `SLASH_ROUTES` in `router.ts`, register in Slack app settings.

---

## Common Issues

**Slack action times out (3s limit)** — all handlers ack immediately with `res.status(200).send('')`
then do async work. Never await slow operations before acking.

**Modal doesn't open** — `trigger_id` is only valid for 3 seconds. Must call `openModal` before
any async DB/API calls.

**Cron fires wrong time** — check UTC vs ET offset. EST = UTC-5, EDT = UTC-4.

**Supabase upsert not working** — `url` is the conflict key on `articles`. Make sure the column
has a UNIQUE constraint in Supabase.
