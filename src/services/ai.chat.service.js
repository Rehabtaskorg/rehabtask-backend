import { prisma } from "../config/prisma.js";
import { UNAVAILABLE_MESSAGE, buildSystemPrompt } from "../config/ai.js";
import { USER_ROLES } from "../utils/constants.js";
import { logger } from "../config/logger.js";
import { generateReply } from "./ai.responder.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const touchSession = ({ sessionId, userId, role }) => {
    if (!sessionId) return;

    prisma.chatSession
        .upsert({
            where: { id: sessionId },
            update: {
                lastActivityAt: new Date(),
                ...(userId && { userId, userRole: role ?? null }),
            },
            create: { id: sessionId, userId: userId ?? null, userRole: role ?? null },
        })
        .catch((err) => logger.error("[AiChat] Session tracking failed", { sessionId, error: err.message }));
};

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

export const answerChat = async ({ messages, sessionId, userId, role, audience }) => {
    touchSession({ sessionId, userId, role });

    try {
        const reply = await generateReply({
            messages,
            systemPrompt: buildSystemPrompt(resolveAudience({ role, audience })),
        });
        return { reply };
    } catch (err) {
        logger.error("[AiChat] Provider call failed", {
            sessionId,
            error: err.message,
            status: err.status,
        });
        throw new ServiceUnavailableError(UNAVAILABLE_MESSAGE, "AI_UNAVAILABLE");
    }
};
