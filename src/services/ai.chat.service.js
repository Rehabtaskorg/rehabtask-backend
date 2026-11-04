import { BUSY_MESSAGE, UNAVAILABLE_MESSAGE, buildSystemPrompt } from "../config/ai.js";
import { logger } from "../config/logger.js";
import { generateReply } from "./ai.responder.js";
import { USER_ROLES } from "../utils/constants.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const PERSON = "someone|somebody|a person|a human|the team|your team|an agent|a rep|a representative";

const ASKED_FOR_A_PERSON = [
    new RegExp(`\\b(speak|talk|chat|contact|reach|call|email)\\b.{0,20}\\b(${PERSON})\\b`),
    /\b(contact|call|email|reach)\b.{0,20}\b(me|us)\b/,
    /\b(human|real person|actual person)\b/,
    /\b(get|have|put)\b.{0,20}\b(in touch|touch with)\b/,
    new RegExp(`\\b(${PERSON})\\b.{0,20}\\b(call|contact|reach|email|get back)\\b`),
    /\bcustomer (service|support)\b/,
];

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
const ABOUT_SOMEONE_ELSE = /\b(therapist|patient|customer|provider)\b/;

const askedForAPerson = (messages) => {
    const latest = messages.at(-1)?.content?.toLowerCase() ?? "";
    if (ABOUT_SOMEONE_ELSE.test(latest)) return false;
    return ASKED_FOR_A_PERSON.some((pattern) => pattern.test(latest));
};

const shouldOfferLead = ({ messages, userId, audience }) =>
    !userId && audience === "public" && askedForAPerson(messages);

/**
 * @param {{ messages: Array<{role: string, content: string}>, sessionId?: string,
 *           userId?: string, role?: string, audience?: string }} params
 * @returns {Promise<{ reply: string, offerLead: boolean }>}
 */
export const answerChat = async ({ messages, sessionId, userId, role, audience, onChunk }) => {
    try {
        const reply = await generateReply({
            messages,
            systemPrompt: buildSystemPrompt(resolveAudience({ role, audience })),
            onChunk,
        });

        return { reply, offerLead: shouldOfferLead({ messages, userId, audience }) };
    } catch (err) {
        const isRateLimited = err.status === 429;

        logger.error("[AiChat] Provider call failed", {
            sessionId,
            error: err.message,
            status: err.status,
            retryAfter: err.retryAfter,
        });

        throw isRateLimited
            ? new ServiceUnavailableError(BUSY_MESSAGE, "AI_BUSY")
            : new ServiceUnavailableError(UNAVAILABLE_MESSAGE, "AI_UNAVAILABLE");
    }
};
