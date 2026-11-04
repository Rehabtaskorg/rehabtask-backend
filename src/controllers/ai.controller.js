import { answerChat } from "../services/ai.chat.service.js";
import { sendChatLead } from "../services/email.service.js";
import { LEAD_ROLES } from "../config/ai.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const sseEvent = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
};

const chatController = async (req, res) => {
    const { messages, sessionId, audience } = req.body;

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
        const { offerLead } = await answerChat({
            messages,
            sessionId,
            audience,
            userId: req.user?.id,
            role: req.user?.role,
            onChunk: (text) => {
                if (!controller.signal.aborted) sseEvent(res, "chunk", { text });
            },
        });

        sseEvent(res, "done", { offerLead });
    } catch (error) {
        sseEvent(res, "error", {
            message: error.message,
            code: error.code ?? "AI_UNAVAILABLE",
        });
    } finally {
        res.end();
    }
};

const leadController = async (req, res, next) => {
    try {
        const { role, name, email, phone, context } = req.body;

        const { success } = await sendChatLead({
            lead: { roleLabel: LEAD_ROLES[role], name, email, phone, context },
        });

        if (!success) {
            throw new ServiceUnavailableError(
                "We could not send your details just now. Please try again or email support@rehabtask.com.",
                "LEAD_SEND_FAILED"
            );
        }

        res.status(200).json({ success: true, data: { email } });
    } catch (error) {
        next(error);
    }
};

export { chatController, leadController };
