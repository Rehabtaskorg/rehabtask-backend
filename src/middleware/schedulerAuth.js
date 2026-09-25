import { env } from "../config/env.js";

export const schedulerAuth = (req, res, next) => {
    const secret = req.headers["x-cloudscheduler-secret"];
    if (!secret || secret !== env.CLOUD_SCHEDULER_SECRET) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
};