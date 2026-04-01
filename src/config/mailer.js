/**
 * Application mail transport — Resend only.
 *
 * Requires RESEND_API_KEY to be set. In test environments emails are skipped.
 */
import { Resend } from 'resend';
import { logger } from './logger.js';
import { env } from './env.js';

const resendClient = new Resend(env.RESEND_API_KEY);

// ---------------------------------------------------------------------------
// Unified send function — never throws, always returns { success, messageId? }
// ---------------------------------------------------------------------------

export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    if (env.NODE_ENV === 'test') {
        logger.info(`[Mailer] Email skipped (NODE_ENV=test): "${subject}" → ${to}`);
        return { success: false, error: 'Email skipped in test environment' };
    }

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
        logger.error('[Mailer] Resend send failed', { to, subject, error: error.message });
        return { success: false, error: error.message };
    }
};