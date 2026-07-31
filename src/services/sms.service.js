import twilio from "twilio";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * @returns {import("twilio").Twilio}
 */
const getClient = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/**
 * @returns {boolean}
 */
const smsEnabled = () => {
    if (env.NODE_ENV === "test") return false;
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return false;
    return true;
};

/**
 * @param {{ to: string, body: string }} params
 * @returns {Promise<void>}
 */
export const sendSms = async ({ to, body }) => {
    if (!smsEnabled()) {
        logger.info("[SmsService] Skipping send — NODE_ENV=test or credentials not configured", { body });
        return;
    }

    const message = await getClient().messages.create({
        from: env.TWILIO_PHONE_NUMBER,
        to,
        body,
    });

    logger.info("[SmsService] SMS sent", { sid: message.sid, status: message.status });
};