import { answerChat } from "../services/ai.chat.service.js";
import { sendChatLead } from "../services/email.service.js";
import { LEAD_CATEGORIES, LEAD_ROLES } from "../config/ai.js";
import { createTicketReference } from "../utils/helpers.js";
import { CUSTOMER_TYPES, USER_ROLES } from "../utils/constants.js";
import { BadRequestError, ServiceUnavailableError } from "../utils/errors.js";

const SIGNED_IN_ROLE_LABEL = {
    [USER_ROLES.THERAPIST]: "Therapist",
    [USER_ROLES.CUSTOMER]: "Customer",
};

const resolveLeadIdentity = ({ user, role, name, email, phone }) => {
    if (!user) {
        if (!role || !name || !email) {
            throw new BadRequestError("Please complete your name, email and role.");
        }
        return { roleLabel: LEAD_ROLES[role], name, email, phone };
    }

    const profile = user.profile ?? user.customerProfile ?? user.therapistProfile ?? {};
    const isAgency = profile.customerType === CUSTOMER_TYPES.AGENCY;

    return {
        roleLabel: isAgency ? "Agency" : SIGNED_IN_ROLE_LABEL[user.role] ?? "Customer",
        name: profile.fullName || profile.agencyName || user.email,
        email: user.email,
        phone: profile.phone ?? undefined,
        accountId: user.id,
    };
};

const sseEvent = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
};

const chatController = async (req, res) => {
    const { messages, sessionId, audience, handoverArranged } = req.body;

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
        const result = await answerChat({
            messages,
            sessionId,
            audience,
            handoverArranged,
            role: req.user?.role,
            onChunk: (text) => {
                if (!controller.signal.aborted) sseEvent(res, "chunk", { text });
            },
        });

        sseEvent(res, "done", {
            offerLead: result.offerLead,
            handoverArranged: result.handoverArranged,
        });
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
        const { role, category, name, email, phone, context } = req.body;
        const identity = resolveLeadIdentity({ user: req.user, role, name, email, phone });
        const reference = createTicketReference();

        const { success } = await sendChatLead({
            lead: {
                ...identity,
                reference,
                category: LEAD_CATEGORIES[category]?.label,
                context,
            },
        });

        if (!success) {
            throw new ServiceUnavailableError(
                "We could not send your details just now. Please try again or email support@rehabtask.com.",
                "LEAD_SEND_FAILED"
            );
        }

        res.status(200).json({ success: true, data: { email: identity.email, reference } });
    } catch (error) {
        next(error);
    }
};

export { chatController, leadController };
