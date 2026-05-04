import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const isProd = process.env.NODE_ENV === "production";

/**
 * Create rate limiter with custom options
 * Uses in-memory storage (no Redis required)
 * Perfect for single-server deployments
 */
const createRateLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,
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

/**
 * Strict rate limiter for authentication endpoints
 * Prevents brute force attacks
 */
export const registrationRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: isProd ? 15 : 1000,
    message: "Too many registration attempts, please try again later",
});

/**
 * Rate limiter for password reset requests
 */
export const passwordResetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: isProd ? 15 : 1000,
    message: "Too many password reset attempts, please try again later",
});

/**
 * Rate limiter for email verification
 */
export const emailVerificationRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: isProd ? 5 : 1000,
    message: "Too many verification attempts, please try again later",
});

/**
 * General API rate limiter
 * Sized for a polling-based messaging app:
 * ~25 req/min from messages page alone × 15 min = 375 baseline
 */
export const apiRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProd ? 600 : 10000,
    message: "Too many requests, please try again later",
    keyGenerator: (req) => {
        return req.user?.id || ipKeyGenerator(req);
    },
    validate: { xForwardedForHeader: true }
});

/**
 * Aggressive rate limiter for sensitive operations
 */
export const sensitiveOperationRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: isProd ? 20 : 1000,
    message: "Rate limit exceeded for this operation.",
});

/**
 * Messaging rate limiter
 * Prevents spam - 20 messages per minute per user
 */
export const messagingRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: isProd ? 20 : 1000,
    message: "Too many messages sent. Please wait a moment.",
    skip: (req) => {
        if (req.path === "/health") return true;
        return req.user?.role === "admin";
    },

    // Rate limit per authenticated user, fallback to IP
    keyGenerator: (req) => {
        return req.user?.id || ipKeyGenerator(req);
    }

})

/**
 * Conversations polling rate limiter
 * Frontend polls every 10s (6/min) + invalidations after sends + page loads
 */
export const conversationsRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: isProd ? 30 : 1000,
    message: "Too many requests. Please wait a moment.",
    keyGenerator: (req) => {
        return req.user?.id || ipKeyGenerator(req);
    }
})