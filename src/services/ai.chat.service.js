import { BUSY_MESSAGE, CONTACT_MARKER, UNAVAILABLE_MESSAGE, buildSystemPrompt } from "../config/ai.js";
import { logger } from "../config/logger.js";
import { generateReply } from "./ai.responder.js";
import { USER_ROLES } from "../utils/constants.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const PERSON =
    "someone|somebody|anyone|anybody|a person|a human|the team|your team|an agent|a rep|a representative|support";

const ASKED_FOR_A_PERSON = [
    new RegExp(`\\b(speak|talk|chat|contact|reach|call|email)\\b.{0,20}\\b(${PERSON})\\b`),
    /\b(contact|call|email|reach)\b.{0,20}\b(me|us)\b/,
    /\b(human|real person|actual person|in person)\b/,
    /\b(get|have|put)\b.{0,20}\b(in touch|touch with)\b/,
    new RegExp(`\\b(${PERSON})\\b.{0,20}\\b(call|contact|reach|email|get back)\\b`),
    /\bcustomer (service|support)\b/,
];

const SIGNED_IN_AUDIENCE = {
    [USER_ROLES.THERAPIST]: "therapist",
    [USER_ROLES.CUSTOMER]: "customer",
};

const resolveAudience = ({ role, audience }) => {
    const fromSession = SIGNED_IN_AUDIENCE[role];
    if (!fromSession) return undefined;
    if (fromSession === "customer" && audience === "agency") return "agency";
    return fromSession;
};

const ABOUT_SOMEONE_ELSE = /\b(therapist|patient|provider)\b/;

const askedForAPerson = (messages) => {
    const latest = messages.at(-1)?.content?.toLowerCase() ?? "";
    if (ABOUT_SOMEONE_ELSE.test(latest)) return false;
    return ASKED_FOR_A_PERSON.some((pattern) => pattern.test(latest));
};

const CLEAR_DECLINE =
    /^(no|nope|nah|no thanks|no thank you|not now|not right now|maybe later|later|i'm good|im good|i am good|no need)\b[\s.!,]*$/;

const isClearDecline = (messages) =>
    CLEAR_DECLINE.test(messages.at(-1)?.content?.toLowerCase().trim() ?? "");

const resolveHandover = ({ messages, reply, handoverArranged }) => {
    if (reply.includes(CONTACT_MARKER)) return true;
    if (isClearDecline(messages)) return false;
    return handoverArranged || askedForAPerson(messages);
};

export const answerChat = async ({ messages, sessionId, role, audience, handoverArranged, onChunk, signal }) => {
    try {
        const reply = await generateReply({
            messages,
            systemPrompt: buildSystemPrompt(resolveAudience({ role, audience }), handoverArranged),
            onChunk,
            signal,
        });

        const offerLead = resolveHandover({ messages, reply, handoverArranged });

        return {
            reply: reply.split(CONTACT_MARKER).join("").trim(),
            offerLead,
            handoverArranged: offerLead,
        };
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
