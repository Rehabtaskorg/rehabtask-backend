/**
 * Application mail transport.
 *
 * Picks the right transport automatically (works in any environment):
 *   - RESEND_API_KEY set              → Resend
 *   - MAILTRAP_API_TOKEN set          → Mailtrap HTTP API (staging/testing)
 *   - GMAIL_USER + GMAIL_APP_PASSWORD → nodemailer/Gmail (local dev)
 *   - Neither                         → emails silently skipped
 *   - NODE_ENV === "test"             → emails skipped
 */
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import { env } from './env.js';


let resendClient = null;
let useMailtrap = false;
let nodemailerTransporter = null;

if (env.RESEND_API_KEY) {
    resendClient = new Resend(env.RESEND_API_KEY);
    logger.info('[Mailer] Using Resend transport');
} else if (env.MAILTRAP_API_TOKEN) {
    useMailtrap = true;
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

    // ── Mailtrap (HTTP API — no SMTP, no extra deps) ─────
    if (useMailtrap) {
        try {
            const fromEmail = env.EMAIL_FROM || 'RehabTask <noreply@rehabtask.com>';
            const fromParts = fromEmail.match(/^(.+?)\s*<(.+)>$/);
            const from = fromParts
                ? { name: fromParts[1], email: fromParts[2] }
                : { name: 'RehabTask', email: fromEmail };

            const inboxId = env.MAILTRAP_INBOX_ID;
            const response = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.MAILTRAP_API_TOKEN}`,
                },
                body: JSON.stringify({
                    from,
                    to: [{ email: to }],
                    subject,
                    html,
                    ...(text && { text }),
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.errors?.join(', ') || JSON.stringify(data));
            }

            logger.info('[Mailer] Email sent via Mailtrap', { to, subject, messageId: data.message_ids?.[0] });
            return { success: true, messageId: data.message_ids?.[0] };
        } catch (error) {
            logger.error('[Mailer] Mailtrap send failed', { to, subject, error: error.message });
            return { success: false, error: error.message };
        }
    }

    // ── Nodemailer / Gmail ──────────────────────────────────
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