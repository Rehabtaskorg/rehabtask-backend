import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RATE_LIMIT, USER_ROLES } from "../utils/constants.js";

const isProd = process.env.NODE_ENV === "production";

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
        return req.user?.id || ipKeyGenerator(req);
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
        return req.user?.id || ipKeyGenerator(req);
    }
});

export const conversationsRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT.MESSAGE_WINDOW_MS,
    max: isProd ? 30 : RATE_LIMIT.MESSAGE_MAX_DEV,
    message: "Too many requests. Please wait a moment.",
    keyGenerator: (req) => {
        return req.user?.id || ipKeyGenerator(req);
    }
});