import { answerChat } from "../services/ai.chat.service.js";
import { sendChatLead } from "../services/email.service.js";
import { LEAD_ROLES } from "../config/ai.js";
import { ServiceUnavailableError } from "../utils/errors.js";

const chatController = async (req, res, next) => {
    try {
        const { messages, sessionId, audience } = req.body;

        const result = await answerChat({
            messages,
            sessionId,
            audience,
            userId: req.user?.id,
            role: req.user?.role,
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
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
