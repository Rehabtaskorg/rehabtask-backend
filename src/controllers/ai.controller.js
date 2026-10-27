import { answerChat } from "../services/ai.chat.service.js";

const chatController = async (req, res, next) => {
    try {
        const { messages, sessionId } = req.body;

        const result = await answerChat({
            messages,
            sessionId,
            userId: req.user?.id,
            role: req.user?.role,
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export { chatController };
