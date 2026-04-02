import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';
import { handleTagPool, handleTagSkip } from '../handlers/wf1-tag';
import { handlePitchApprove, handlePitchReject, handlePitchRejectSubmit, handlePitchHold } from '../handlers/wf2-pitch';
import { handleBlogApprove, handleBlogFeedback, handleBlogFeedbackSubmit, handleBlogEdit, handleBlogEditSubmit } from '../handlers/wf3a-blog';
import { handleOutputApprove, handleEditSnippet, handleEditSnippetSubmit, handleEditLinkedin, handleEditBrokerKit } from '../handlers/wf3b-outputs';
import { handleSlashStatus, handleSlashGenerateBlog, handleSlashViewArticles, handleSlashRunWF1, handleSlashDebug } from '../handlers/slash';

export const slackRouter = Router();

// ─── Signature Verification ───────────────────────────────────────────────────

function verifySlackSignature(req: Request): boolean {
  const ts = req.headers['x-slack-request-timestamp'] as string;
  const sig = req.headers['x-slack-signature'] as string;
  if (!ts || !sig) return false;

  // Reject requests older than 5 min
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const rawBody = req.body ? new URLSearchParams(req.body).toString() : '';
  const baseStr = `v0:${ts}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', ENV.SLACK_SIGNING_SECRET).update(baseStr).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Actions Router ───────────────────────────────────────────────────────────

// Routing table: action_id → handler
const ACTION_ROUTES: Record<string, (payload: SlackPayload, res: Response) => Promise<void>> = {
  scbdm_tag_pool:              handleTagPool,
  scbdm_tag_skip:              handleTagSkip,
  scbdm_pitch_approve:         handlePitchApprove,
  scbdm_pitch_reject:          handlePitchReject,
  scbdm_pitch_hold:            handlePitchHold,
  scbdm_blog_approve:          handleBlogApprove,
  scbdm_blog_feedback:         handleBlogFeedback,
  scbdm_blog_edit:             handleBlogEdit,
  scbdm_output_approve:        handleOutputApprove,
  scbdm_edit_snippet:          handleEditSnippet,
  scbdm_edit_linkedin:         handleEditLinkedin,
  scbdm_edit_brokerkit:        handleEditBrokerKit,
};

// Modal submission routing
const MODAL_ROUTES: Record<string, (payload: SlackPayload, res: Response) => Promise<void>> = {
  scbdm_pitch_reject_submit:   handlePitchRejectSubmit,
  scbdm_blog_feedback_submit:  handleBlogFeedbackSubmit,
  scbdm_blog_edit_submit:      handleBlogEditSubmit,
  scbdm_edit_snippet_submit:   handleEditSnippetSubmit,
};

export type SlackPayload = {
  type: string;
  callback_id?: string;
  trigger_id: string;
  user: { id: string; name: string };
  channel?: { id: string };
  message?: { ts: string };
  actions?: Array<{ action_id: string; value: string }>;
  view?: {
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, { value?: string; selected_options?: Array<{value: string}> }>> };
  };
};

slackRouter.post('/actions', async (req: Request, res: Response) => {
  // Ack immediately
  res.status(200).send('');

  let payload: SlackPayload;
  try {
    payload = JSON.parse(req.body?.payload || '{}');
  } catch (e) {
    log.error('Failed to parse Slack payload', e);
    return;
  }

  log.info(`Slack action received: type=${payload.type}`, {
    callback_id: payload.callback_id,
    actions: payload.actions?.map(a => a.action_id),
  });

  try {
    if (payload.type === 'block_actions' && payload.actions?.length) {
      const actionId = payload.actions[0].action_id;
      const handler = ACTION_ROUTES[actionId];
      if (handler) {
        await handler(payload, res);
      } else {
        log.warn(`No handler for action_id: ${actionId}`);
      }
    } else if (payload.type === 'view_submission' && payload.view) {
      const callbackId = payload.view.callback_id;
      const handler = MODAL_ROUTES[callbackId];
      if (handler) {
        await handler(payload, res);
      } else {
        log.warn(`No handler for modal callback_id: ${callbackId}`);
      }
    }
  } catch (err) {
    log.error('Handler error', err);
    // Post error to debug channel if configured
    if (ENV.CHANNEL_DEBUG) {
      const { postMessage } = await import('./blocks');
      // postMessage is from blocks — use the slack method directly
    }
  }
});

// ─── Slash Commands ───────────────────────────────────────────────────────────

const SLASH_ROUTES: Record<string, (body: SlashBody, res: Response) => Promise<void>> = {
  '/sc-status':        handleSlashStatus,
  '/generateblog':     handleSlashGenerateBlog,
  '/viewarticles':     handleSlashViewArticles,
  '/runwf1':           handleSlashRunWF1,
  '/scdebug':          handleSlashDebug,
};

export type SlashBody = {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  trigger_id: string;
};

slackRouter.post('/commands', async (req: Request, res: Response) => {
  log.info('Slash command raw body', req.body);
  const body = req.body as SlashBody;
  log.info(`Slash command received: ${body.command}`);
  const handler = SLASH_ROUTES[body.command];

  if (!handler) {
    res.json({ response_type: 'ephemeral', text: `Unknown command: ${body.command}` });
    return;
  }

  try {
    await handler(body, res);
  } catch (err) {
    log.error(`Slash command error: ${body.command}`, err);
    res.json({ response_type: 'ephemeral', text: `❌ Error: ${(err as Error).message}` });
  }
});
