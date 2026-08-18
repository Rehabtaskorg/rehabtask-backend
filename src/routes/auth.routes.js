import express from "express";
import {
    registerCustomerController,
    registerTherapistController,
    loginController,
    logoutController,
    getCurrentUserController,
    requestPasswordResetController,
    changePasswordController,
    resendVerificationEmailController,
    processOAuthController,
    completeOAuthOnboardingController,
    refreshTokenController,
    verifyEmailController
} from "../controllers/auth.controller.js";
import {
    acceptAgreementController,
    getAgreementContentController,
} from "../controllers/agreement.controller.js";
import { authenticate } from "../middleware/auth.js";
import { recaptchaMiddleware } from "../middleware/recaptcha.js";
import { validate } from "../middleware/validate.js";
import {
    registerCustomerSchema,
    registerTherapistSchema,
    loginSchema,
    requestPasswordResetSchema,
    changePasswordSchema,
    resendVerificationSchema,
    completeOAuthOnboardingSchema
} from "../validators/auth.schema.js";
import {
    registrationRateLimiter,
    passwordResetLimiter,
    emailVerificationRateLimiter,
    sensitiveOperationRateLimiter
} from "../middleware/rateLimiter.js";


const router = express.Router();

/**
 * Public routes (no authentication required)
 */

// Registration routes
router.post(
    "/register/customer",
    recaptchaMiddleware,
    registrationRateLimiter,
    validate(registerCustomerSchema),
    registerCustomerController
);

router.post(
    "/register/therapist",
    recaptchaMiddleware,
    registrationRateLimiter,
    validate(registerTherapistSchema),
    registerTherapistController
);

// Login
router.post(
    "/login",
    recaptchaMiddleware,
    sensitiveOperationRateLimiter,
    validate(loginSchema),
    loginController
);

// Verify email in DB (called by frontend after magic link)
router.post("/verify-email", verifyEmailController);

// Password reset
router.post(
    "/password/forgot",
    recaptchaMiddleware,
    passwordResetLimiter,
    validate(requestPasswordResetSchema),
    requestPasswordResetController
);

// Resend verification email
router.post(
    "/email/resend",
    recaptchaMiddleware,
    emailVerificationRateLimiter,
    validate(resendVerificationSchema),
    resendVerificationEmailController
);

/**
 * OAuth routes
 * Process OAuth token from frontend
 */
router.post("/oauth/process", processOAuthController);

// POST endpoint for completing OAuth with role selection
router.post(
    "/oauth/onboarding",
    authenticate,
    validate(completeOAuthOnboardingSchema),
    completeOAuthOnboardingController
);


// Refresh token
router.post("/token/refresh", refreshTokenController);

/**
 * Protected routes (authentication required)
 */

router.post("/logout", logoutController);

// Get current user
router.get("/me", authenticate, getCurrentUserController);

// Generate a one-time ticket for Socket.io authentication
// The ticket is short-lived (30s) and can only be used once.
// This avoids exposing the access token to JavaScript while still
// allowing cross-origin Socket.io auth where cookies aren't sent.
const socketTickets = new Map();
router.get("/socket-ticket", authenticate, (req, res) => {
    const ticket = `tkt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    socketTickets.set(ticket, { userId: req.user.id, createdAt: Date.now() });
    // Expire old tickets (cleanup)
    for (const [key, val] of socketTickets) {
        if (Date.now() - val.createdAt > 30000) socketTickets.delete(key);
    }
    res.json({ success: true, data: { ticket } });
});
// Export for socket auth middleware
export { socketTickets };

router.post(
    "/password/change",
    authenticate,
    validate(changePasswordSchema),
    changePasswordController
);

router.get("/agreement/content", authenticate, getAgreementContentController);
router.post("/agreement/accept", authenticate, acceptAgreementController);

export default router;