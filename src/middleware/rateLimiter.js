import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RATE_LIMIT, USER_ROLES } from "../utils/constants.js";
import { logger } from "../config/logger.js";

const isProd = process.env.NODE_ENV === "production";

const clientKey = (req) => {
    if (req.user?.id) return req.user.id;

    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = forwarded?.split(",")[0]?.trim();
    return ipKeyGenerator(clientIp || req.ip);
};

const createRateLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: RATE_LIMIT.API_WINDOW_MS,
        max: RATE_LIMIT.API_MAX_PROD,
        message: "Too many requests from this IP, please try again later",
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                code: "RATE_LIMIT_EXCEEDED",
                message: options.message || "Too many requests, please try again later",
            });
        },
        skip: (req) => {
            return req.path === "/health";
        },
    };

    return rateLimit({ ...defaultOptions, ...options });
}

export const registrationRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.SENSITIVE_WINDOW_MS,
    max: isProd ? RATE_LIMIT.SENSITIVE_MAX_PROD : RATE_LIMIT.SENSITIVE_MAX_DEV,
    message: "Too many registration attempts, please try again later",
});

export const passwordResetLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.SENSITIVE_WINDOW_MS,
    max: isProd ? RATE_LIMIT.SENSITIVE_MAX_PROD : RATE_LIMIT.SENSITIVE_MAX_DEV,
    message: "Too many password reset attempts, please try again later",
});

export const emailVerificationRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.AUTH_WINDOW_MS,
    max: isProd ? RATE_LIMIT.AUTH_MAX_PROD : RATE_LIMIT.AUTH_MAX_DEV,
    message: "Too many verification attempts, please try again later",
});

export const apiRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.SOCKET_WINDOW_MS,
    max: isProd ? RATE_LIMIT.SOCKET_MAX_PROD : RATE_LIMIT.SOCKET_MAX_DEV,
    message: "Too many requests, please try again later",
    keyGenerator: (req) => {
        return clientKey(req);
    },
    validate: { xForwardedForHeader: true }
});

export const sensitiveOperationRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.UPLOAD_WINDOW_MS,
    max: isProd ? RATE_LIMIT.UPLOAD_MAX_PROD : RATE_LIMIT.UPLOAD_MAX_DEV,
    message: "Rate limit exceeded for this operation.",
});

export const messagingRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.MESSAGE_WINDOW_MS,
    max: isProd ? RATE_LIMIT.MESSAGE_MAX_PROD : RATE_LIMIT.MESSAGE_MAX_DEV,
    message: "Too many messages sent. Please wait a moment.",
    skip: (req) => {
        if (req.path === "/health") return true;
        return req.user?.role === USER_ROLES.ADMIN;
    },
    keyGenerator: (req) => {
        return clientKey(req);
    }
});

export const conversationsRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.MESSAGE_WINDOW_MS,
    max: isProd ? 30 : RATE_LIMIT.MESSAGE_MAX_DEV,
    message: "Too many requests. Please wait a moment.",
    keyGenerator: (req) => {
        return clientKey(req);
    }
});
const aiBurstMax = isProd ? RATE_LIMIT.AI_BURST_MAX_PROD : RATE_LIMIT.AI_BURST_MAX_DEV;

logger.info("[RateLimit] AI chat limits resolved", {
    nodeEnv: process.env.NODE_ENV,
    isProd,
    burstMax: aiBurstMax,
    burstWindowMs: RATE_LIMIT.AI_BURST_WINDOW_MS,
});

export const aiChatBurstLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.AI_BURST_WINDOW_MS,
    max: aiBurstMax,
    message: "You're sending messages too quickly. Please wait a moment.",
    keyGenerator: clientKey,
});

export const aiChatHourlyLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.AI_HOURLY_WINDOW_MS,
    max: isProd ? RATE_LIMIT.AI_HOURLY_MAX_PROD : RATE_LIMIT.AI_HOURLY_MAX_DEV,
    message: "You've reached the chat limit for now. Please try again later or contact support.",
    keyGenerator: clientKey,
});
