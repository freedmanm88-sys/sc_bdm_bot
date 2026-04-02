-- ============================================================
-- Stonefield BDM — Initial Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Articles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS articles (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           text NOT NULL,
  url             text NOT NULL UNIQUE,
  summary         text NOT NULL DEFAULT '',
  source          text NOT NULL DEFAULT '',
  relevance_score integer NOT NULL DEFAULT 5,
  broker_angle    text NOT NULL DEFAULT '',
  published_at    timestamptz NOT NULL DEFAULT now(),
  collected_at    timestamptz NOT NULL DEFAULT now(),
  queue           text NOT NULL DEFAULT 'pending'
                  CHECK (queue IN ('pending','approved','rejected','queued_next')),
  tagged_at       timestamptz,
  used_in_email   boolean NOT NULL DEFAULT false,
  slack_ts        text,
  slack_channel   text
);

CREATE INDEX IF NOT EXISTS idx_articles_queue ON articles(queue);
CREATE INDEX IF NOT EXISTS idx_articles_collected ON articles(collected_at);

-- ─── Narrative Pitches ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS narrative_pitches (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  headline            text NOT NULL,
  summary             text NOT NULL DEFAULT '',
  article_ids         uuid[] NOT NULL DEFAULT '{}',
  article_rationale   jsonb NOT NULL DEFAULT '{}',
  suggested_blog_title text NOT NULL DEFAULT '',
  lens                text NOT NULL
                      CHECK (lens IN (
                        'INVESTMENT OPPORTUNITY',
                        'PERSONAL FINANCE FOR HOMEOWNERS',
                        'HOME BUILDERS & DEVELOPERS',
                        'BUY OR SELL NOW?'
                      )),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','held')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pitches_status ON narrative_pitches(status);

-- ─── Blog Posts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pitch_id         uuid REFERENCES narrative_pitches(id),
  article_ids      uuid[] NOT NULL DEFAULT '{}',
  title            text NOT NULL,
  slug             text NOT NULL DEFAULT '',
  body_html        text NOT NULL DEFAULT '',
  meta_description text NOT NULL DEFAULT '',
  focus_keyword    text NOT NULL DEFAULT '',
  geo_signals      jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','exported','published')),
  wp_post_id       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blogs_status ON blog_posts(status);

-- ─── Pitch Feedback ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pitch_feedback (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pitch_id    uuid REFERENCES narrative_pitches(id),
  article_ids uuid[] NOT NULL DEFAULT '{}',
  reason      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Voice Feedback ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_feedback (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type  text NOT NULL
                CHECK (content_type IN ('blog','newsletter','linkedin','broker_template','broker_ai')),
  note          text NOT NULL DEFAULT '',
  blog_post_id  uuid REFERENCES blog_posts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_content_type ON voice_feedback(content_type);

-- ─── Pending Sends ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_sends (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  blog_post_id  uuid REFERENCES blog_posts(id),
  email_html    text NOT NULL DEFAULT '',
  subject_a     text NOT NULL DEFAULT '',
  subject_b     text NOT NULL DEFAULT '',
  article_ids   uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent'))
);

-- ─── Brokers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brokers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             text NOT NULL UNIQUE,
  first_name        text NOT NULL DEFAULT '',
  last_name         text NOT NULL DEFAULT '',
  name              text NOT NULL DEFAULT '',
  brokerage         text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','soft_bounce','hard_bounce','complained','unsubscribed')),
  bounce_count      integer NOT NULL DEFAULT 0,
  last_opened_at    timestamptz,
  last_clicked_at   timestamptz,
  added_at          timestamptz NOT NULL DEFAULT now(),
  resend_contact_id text
);

CREATE INDEX IF NOT EXISTS idx_brokers_status ON brokers(status);
