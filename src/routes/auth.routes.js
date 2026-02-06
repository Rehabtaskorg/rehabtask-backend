import express from "express";
import {
    registerCustomerController,
    registerTherapistController,
    loginController,
    logoutController,
    getCurrentUserController,
    requestPasswordResetController,
    resetPasswordController,
    changePasswordController,
    resendVerificationEmailController,
    oauthCallbackController,
    completeOAuthOnboardingController,
    refreshTokenController,
    verifyEmailController
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    registerCustomerSchema,
    registerTherapistSchema,
    loginSchema,
    requestPasswordResetSchema,
    resetPasswordSchema,
    changePasswordSchema,
    resendVerificationSchema
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
    registrationRateLimiter,
    validate(registerCustomerSchema),
    registerCustomerController
);

router.post(
    "/register/therapist",
    registrationRateLimiter,
    validate(registerTherapistSchema),
    registerTherapistController
);

// Login
router.post(
    "/login", // brute force protection
    sensitiveOperationRateLimiter,
    validate(loginSchema),
    loginController
);

// Verify email in DB (called by frontend after magic link)
router.post("/verify-email", verifyEmailController);

// Password reset
router.post(
    "/password/forgot",
    passwordResetLimiter,
    validate(requestPasswordResetSchema),
    requestPasswordResetController
);

router.post(
    "/password/reset",
    passwordResetLimiter,
    validate(resetPasswordSchema),
    resetPasswordController
);

// Resend verification email
router.post(
    "/email/resend",
    emailVerificationRateLimiter, // prevents
    validate(resendVerificationSchema),
    resendVerificationEmailController
);


// OAuth routes
router.post("/oauth/callback", oauthCallbackController)
router.post("/oauth/onboarding", authenticate, completeOAuthOnboardingController);


// Refresh token
router.post("/token/refresh", refreshTokenController);

/**
 * Protected routes (authentication required)
 */

// Logout
router.post("/logout", authenticate, logoutController);

// Get current user
router.get("/me", authenticate, getCurrentUserController);

// Change password
router.post(
    "/password/change",
    authenticate,
    validate(changePasswordSchema),
    changePasswordController);

export default router;