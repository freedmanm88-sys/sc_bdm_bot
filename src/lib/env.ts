import 'dotenv/config';

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const ENV = {
  SUPABASE_URL:        require_env('SUPABASE_URL'),
  SUPABASE_KEY:        require_env('SUPABASE_SERVICE_ROLE_KEY'),
  SLACK_BOT_TOKEN:     require_env('SLACK_BOT_TOKEN'),
  SLACK_SIGNING_SECRET:require_env('SLACK_SIGNING_SECRET'),
  CLAUDE_API_KEY:      require_env('CLAUDE_API_KEY'),
  RESEND_API_KEY:      require_env('RESEND_API_KEY'),
  WP_APP_PASSWORD:     process.env.WP_APP_PASSWORD || '',
  WP_AUTO_PUBLISH:     process.env.WP_AUTO_PUBLISH === 'true',
  PRICING_SHEET_ID:    process.env.PRICING_SHEET_ID || '',

  // Slack channel IDs
  CHANNEL_NEWSLETTER:  process.env.SLACK_CHANNEL_NEWSLETTER || 'C0APDC7EASU',
  CHANNEL_DEBUG:       process.env.SLACK_CHANNEL_DEBUG || '',

  PORT: process.env.PORT || '3000',
  NODE_ENV: process.env.NODE_ENV || 'development',
};
