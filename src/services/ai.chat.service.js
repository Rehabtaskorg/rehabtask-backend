import { UNAVAILABLE_MESSAGE, buildSystemPrompt } from "../config/ai.js";
import { logger } from "../config/logger.js";
import { generateReply } from "./ai.responder.js";
import { USER_ROLES } from "../utils/constants.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const LEAD_OFFER_AFTER_QUESTIONS = 2;

const SIGNED_IN_AUDIENCE = {
    [USER_ROLES.THERAPIST]: "therapist",
    [USER_ROLES.CUSTOMER]: "customer",
};

/**
 * A signed-in user's audience comes from their session, never from the request body,
 * which any caller can set. "agency" is the one case the body may refine: agencies are
 * customers, so the session alone cannot tell them apart.
 */
const resolveAudience = ({ role, audience }) => {
    const fromSession = SIGNED_IN_AUDIENCE[role];
    if (!fromSession) return undefined;
    if (fromSession === "customer" && audience === "agency") return "agency";
    return fromSession;
};

/**
 * Whether to offer the lead card after this reply. Decided here from the request,
 * never by the model, so it cannot be malformed, leaked into a reply or induced by
 * anything the user types. Signed-in users are routed to support instead.
 */
const shouldOfferLead = ({ messages, userId, audience }) =>
    !userId &&
    audience === "public" &&
    messages.filter((m) => m.role === "user").length >= LEAD_OFFER_AFTER_QUESTIONS;

/**
 * @param {{ messages: Array<{role: string, content: string}>, sessionId?: string,
 *           userId?: string, role?: string, audience?: string }} params
 * @returns {Promise<{ reply: string, offerLead: boolean }>}
 */
export const answerChat = async ({ messages, sessionId, userId, role, audience }) => {
    try {
        const reply = await generateReply({
            messages,
            systemPrompt: buildSystemPrompt(resolveAudience({ role, audience })),
        });

        return { reply, offerLead: shouldOfferLead({ messages, userId, audience }) };
    } catch (err) {
        logger.error("[AiChat] Provider call failed", {
            sessionId,
            error: err.message,
            status: err.status,
        });
        throw new ServiceUnavailableError(UNAVAILABLE_MESSAGE, "AI_UNAVAILABLE");
    }
};
