/**
 * Application mail transport
 * 
 * DEV: nodemailer + Gmail APP password (active below)
 * PROD: Resend API (commented out below - swap when deploying)
 */
import nodemailer from "nodemailer";
import { logger } from "./logger.js";
import { env } from "./env.js";

/**Active: nodemailer + Gmail (development) */
let transporter = null;

if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: env.GMAIL_USER,
            pass: env.GMAIL_APP_PASSWORD,
        },
    });
} else {
    logger.warn('[Mailer] GMAIL_USER or GMAIL_APP_PASSWORD not set — emails will be skipped in dev');
}

/**
 * Send a single email
 * Returns { success, messageId?, error? } - never throw
 */
export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    if (!transporter) {
        logger.warn('[Mailer] No transport — skipping email', { to, subject });
        return { success: false, error: 'No mail transport configured' };
    }

    try {
        const info = await transporter.sendMail({
            from: `"${env.EMAIL_FROM_NAME || 'RehabTask'}" <${env.GMAIL_USER}>`,
            to,
            subject,
            html,
            ...(text && { text }),
            ...(replyTo && { replyTo }),
        });
        logger.info('[Mailer] Email sent', { to, subject, messageId: info.messageId })
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error('[Mailer] Send failed', { to, subject, error: error.message });
        return { success: false, error: error.message };
    }
};

// ---------------------------------------------------------------------------
// PRODUCTION SWITCH — when deploying:
//   1. Comment out the entire "ACTIVE: nodemailer" block above
//   2. Uncomment the entire block below
//   3. Ensure RESEND_API_KEY is set in production .env
// ---------------------------------------------------------------------------

// import { Resend } from 'resend';
// import { logger } from './logger.js';
// import { env } from './env.js';
//
// if (!env.RESEND_API_KEY) {
//     throw new Error('[Mailer] RESEND_API_KEY is required in production');
// }
//
// const resendClient = new Resend(env.RESEND_API_KEY);
//
// export const sendMail = async ({ to, subject, html, text, replyTo }) => {
//     try {
//         const response = await resendClient.emails.send({
//             from: env.EMAIL_FROM,
//             to, subject, html,
//             ...(text && { text }),
//             ...(replyTo && { replyTo }),
//         });
//         logger.info('[Mailer] Email sent via Resend', { to, subject, emailId: response.id });
//         return { success: true, messageId: response.id };
//     } catch (error) {
//         logger.error('[Mailer] Resend send failed', { to, subject, error: error.message });
//         return { success: false, error: error.message };
//     }
// };