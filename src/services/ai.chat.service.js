import { prisma } from "../config/prisma.js";
import { UNAVAILABLE_MESSAGE } from "../config/ai.js";
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

export const answerChat = async ({ messages, sessionId, userId, role }) => {
    touchSession({ sessionId, userId, role });

    try {
        const reply = await generateReply({ messages });
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
