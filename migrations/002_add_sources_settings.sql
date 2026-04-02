-- ============================================================
-- Sources & Settings tables
-- Run this in the Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS rss_sources (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  url        text NOT NULL UNIQUE,
  name       text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  added_at   timestamptz NOT NULL DEFAULT now()
);

-- Seed with the default RSS feeds
INSERT INTO rss_sources (url, name) VALUES
  ('https://www.ratespy.com/feed', 'RateSpy'),
  ('https://www.mortgagebrokernews.ca/rss/news', 'Mortgage Broker News'),
  ('https://financialpost.com/feed', 'Financial Post'),
  ('https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/', 'Globe & Mail Real Estate'),
  ('https://www.crea.ca/feed/', 'CREA'),
  ('https://renx.ca/feed', 'RENX'),
  ('https://storeys.com/feed', 'Storeys')
ON CONFLICT (url) DO NOTHING;

CREATE TABLE IF NOT EXISTS bot_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bot_settings (key, value) VALUES
  ('MIN_SCORE', '5')
ON CONFLICT (key) DO NOTHING;
