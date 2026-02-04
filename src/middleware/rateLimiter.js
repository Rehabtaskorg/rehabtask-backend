import rateLimit from "express-rate-limit";

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
        validate: { xForwardedForHeader: false },
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
    max: 15, // 15 registrations per hour,
    message: "Too many registration attempts, please try again later",
});

/**
 * Rate limiter for password reset requests
 */
export const passwordResetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: 15, // 3 password reset requests per hour,
    message: "Too many password reset attempts, please try again later",
});

/**
 * Rate limiter for email verification
 */
export const emailVerificationRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: 5, // 5 verification attempts per hour,
    message: "Too many verification attempts, please try again later",
});

/**
 * General API rate limiter
 */
export const apiRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // 100 requests per 15 minutes,
    message: "Too many requests, please try again later",
});

/**
 * Aggressive rate limiter for sensitive operations
 */
export const sensitiveOperationRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1hr
    max: 10, // 10 requests per hour,
    message: "Rate limit exceeded for this operation.",
});