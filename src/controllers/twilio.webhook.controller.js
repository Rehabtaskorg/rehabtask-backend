import twilio from "twilio";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { syncTwilioOptStatus } from "../services/sms.service.js";

/**
 * Verify that an inbound request genuinely came from Twilio.
 * Uses the request signature + auth token to validate.
 * Cloud Run sits behind a Google load balancer — req.protocol may be "http"
 * internally, so we reconstruct the URL from the public API_URL env var instead
 * of trusting req.protocol + req.hostname.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
const isTwilioRequest = (req) => {
    const signature = req.headers["x-twilio-signature"];
    if (!signature || !env.TWILIO_AUTH_TOKEN) return false;

    const publicUrl = `${env.API_URL}${req.originalUrl}`;

    return twilio.validateRequest(
        env.TWILIO_AUTH_TOKEN,
        signature,
        publicUrl,
        req.body
    );
};

/**
 * Middleware: reject requests that fail Twilio signature validation.
 * Applied only to Twilio inbound routes — not globally.
 *
 * @type {import("express").RequestHandler}
 */
export const validateTwilioSignature = (req, res, next) => {
    if (!isTwilioRequest(req)) {
        logger.warn("[TwilioWebhook] Invalid signature — request rejected", {
            url: req.originalUrl,
            ip: req.ip,
        });
        return res.status(403).json({ error: "Forbidden" });
    }
    next();
};

/**
 * Handle inbound STOP keyword from a US phone number.
 * Twilio fires this POST when a user texts any opt-out keyword
 * (STOP, CANCEL, QUIT, UNSUBSCRIBE, REVOKE, END, STOPALL).
 * Advanced Opt-Out on the Messaging Service has already auto-replied
 * to the user and suppressed their number — this handler syncs the
 * DB smsOptIn flag so both systems agree.
 *
 * Twilio expects a 200 response or it will retry delivery.
 *
 * @type {import("express").RequestHandler}
 */
export const handleTwilioOptOut = async (req, res) => {
    const phone = req.body?.From;

    if (!phone) {
        logger.warn("[TwilioWebhook] opt-out received with no From field");
        return res.status(200).send("<Response/>");
    }

    try {
        await syncTwilioOptStatus(phone, false);
    } catch (err) {
        logger.error("[TwilioWebhook] opt-out DB sync failed", { error: err.message });
    }

    res.status(200).send("<Response/>");
};

/**
 * Handle inbound START keyword from a US phone number.
 * Twilio fires this POST when a user texts START, YES, or UNSTOP
 * after having previously opted out. Twilio has already removed the
 * number from its suppression list — this handler syncs smsOptIn = true
 * back to the DB.
 *
 * @type {import("express").RequestHandler}
 */
export const handleTwilioOptIn = async (req, res) => {
    const phone = req.body?.From;

    if (!phone) {
        logger.warn("[TwilioWebhook] opt-in received with no From field");
        return res.status(200).send("<Response/>");
    }

    try {
        await syncTwilioOptStatus(phone, true);
    } catch (err) {
        logger.error("[TwilioWebhook] opt-in DB sync failed", { error: err.message });
    }

    res.status(200).send("<Response/>");
};
