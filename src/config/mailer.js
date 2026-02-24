/**
 * Application mail transport.
 *
 * Picks the right transport automatically:
 *   - RESEND_API_KEY set     → Resend (production)
 *   - GMAIL_USER/PASS set    → nodemailer/Gmail (development)
 *   - Neither                → emails silently skipped
 */
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import { env } from './env.js';


let resendClient = null;
let nodemailerTransporter = null;

if (env.RESEND_API_KEY) {
    resendClient = new Resend(env.RESEND_API_KEY);
    logger.info('[Mailer] Using Resend transport (production)');
} else if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    nodemailerTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: env.GMAIL_USER,
            pass: env.GMAIL_APP_PASSWORD,
        },
    });
    logger.info('[Mailer] Using Gmail/nodemailer transport (development)');
} else {
    logger.warn('[Mailer] No email transport configured — emails will be skipped');
}

// ---------------------------------------------------------------------------
// Unified send function — never throws
// ---------------------------------------------------------------------------

export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    // Skip all email sending outside of production
    if (process.env.NODE_ENV !== "production") {
        logger.info(`[mailer] Email skipped (NODE_ENV=${process.env.NODE_ENV}): "${subject}" → ${to}`);
        return { success: false, error: "Email skipped in non-production environment" };
    }

    // ── Resend (production) ─────────────────────────────────
    if (resendClient) {
        try {
            const response = await resendClient.emails.send({
                from: env.EMAIL_FROM || 'RehabTask <noreply@rehabtask.com>',
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
    }

    // ── Nodemailer / Gmail (development) ────────────────────
    if (nodemailerTransporter) {
        try {
            const info = await nodemailerTransporter.sendMail({
                from: `"${env.EMAIL_FROM_NAME || 'RehabTask'}" <${env.GMAIL_USER}>`,
                to,
                subject,
                html,
                ...(text && { text }),
                ...(replyTo && { replyTo }),
            });
            logger.info('[Mailer] Email sent via Gmail', { to, subject, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error) {
            logger.error('[Mailer] Gmail send failed', { to, subject, error: error.message });
            return { success: false, error: error.message };
        }
    }

    logger.warn('[Mailer] No transport — skipping email', { to, subject });
    return { success: false, error: 'No mail transport configured' };
};