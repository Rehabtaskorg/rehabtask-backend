/**
 * Application mail transport.
 *
 * Picks the right transport automatically (works in any environment):
 *   - RESEND_API_KEY set              → Resend
 *   - MAILTRAP_API_TOKEN set          → Mailtrap via nodemailer (staging/testing)
 *   - GMAIL_USER + GMAIL_APP_PASSWORD → nodemailer/Gmail (local dev)
 *   - Neither                         → emails silently skipped
 *   - NODE_ENV === "test"             → emails skipped
 */
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { MailtrapTransport } from 'mailtrap';
import { logger } from './logger.js';
import { env } from './env.js';


let resendClient = null;
let nodemailerTransporter = null;

if (env.RESEND_API_KEY) {
    resendClient = new Resend(env.RESEND_API_KEY);
    logger.info('[Mailer] Using Resend transport');
} else if (env.MAILTRAP_API_TOKEN) {
    nodemailerTransporter = nodemailer.createTransport(
        MailtrapTransport({ token: env.MAILTRAP_API_TOKEN })
    );
    logger.info('[Mailer] Using Mailtrap transport');
}
// ── Gmail (local dev — commented out; Render blocks SMTP ports) ──────
// else if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
//     nodemailerTransporter = nodemailer.createTransport({
//         service: 'gmail',
//         auth: {
//             user: env.GMAIL_USER,
//             pass: env.GMAIL_APP_PASSWORD,
//         },
//     });
//     logger.info('[Mailer] Using Gmail/nodemailer transport');
// }
else {
    logger.warn('[Mailer] No email transport configured — emails will be skipped');
}

// ---------------------------------------------------------------------------
// Unified send function — never throws
// ---------------------------------------------------------------------------

export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    // Skip email sending only in test environment
    if (process.env.NODE_ENV === "test") {
        logger.info(`[mailer] Email skipped (NODE_ENV=test): "${subject}" → ${to}`);
        return { success: false, error: "Email skipped in test environment" };
    }

    // ── Resend ─────────────────────────────────────────────
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

    // ── Nodemailer (Mailtrap or Gmail) ─────────────────────
    if (nodemailerTransporter) {
        try {
            const fromAddress = env.MAILTRAP_API_TOKEN
                ? (env.EMAIL_FROM || 'RehabTask <noreply@rehabtask.com>')
                : `"${env.EMAIL_FROM_NAME || 'RehabTask'}" <${env.GMAIL_USER}>`;
            const info = await nodemailerTransporter.sendMail({
                from: fromAddress,
                to,
                subject,
                html,
                ...(text && { text }),
                ...(replyTo && { replyTo }),
            });
            const transport = env.MAILTRAP_API_TOKEN ? 'Mailtrap' : 'Gmail';
            logger.info(`[Mailer] Email sent via ${transport}`, { to, subject, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error) {
            const transport = env.MAILTRAP_API_TOKEN ? 'Mailtrap' : 'Gmail';
            logger.error(`[Mailer] ${transport} send failed`, { to, subject, error: error.message });
            return { success: false, error: error.message };
        }
    }

    logger.warn('[Mailer] No transport — skipping email', { to, subject });
    return { success: false, error: 'No mail transport configured' };
};