import { Resend } from 'resend';
import { logger } from './logger.js';
import { env } from './env.js';

const resendClient = new Resend(env.RESEND_API_KEY);

const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    if (env.NODE_ENV === 'test') {
        logger.info(`[Mailer] Email skipped (NODE_ENV=test): "${subject}" → ${to}`);
        return { success: false, error: 'Email skipped in test environment' };
    }

    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await resendClient.emails.send({
                from: env.EMAIL_FROM || 'RehabTask <app@rehabtask.com>',
                to,
                subject,
                html,
                ...(text && { text }),
                ...(replyTo && { replyTo }),
            });
            logger.info('[Mailer] Email sent via Resend', { to, subject, emailId: response.id });
            return { success: true, messageId: response.id };
        } catch (error) {
            lastError = error;
            const status = error?.statusCode ?? error?.status;
            const isRateLimited = status === 429;
            const isTransient = isRateLimited || status === 503 || status === 504;

            if (!isTransient || attempt === MAX_ATTEMPTS) {
                logger.error('[Mailer] Resend send failed', { to, subject, attempt, error: error.message });
                return { success: false, error: error.message };
            }

            const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
            logger.warn('[Mailer] Resend rate limited — retrying', { to, subject, attempt, backoffMs: backoff });
            await sleep(backoff);
        }
    }

    return { success: false, error: lastError?.message ?? 'Unknown error' };
};