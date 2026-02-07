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
    oauthCallbackController,
    completeOAuthOnboardingController,
    refreshTokenController,
    verifyEmailController
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { recaptchaMiddleware } from "../middleware/recaptcha.js";
import { validate } from "../middleware/validate.js";
import {
    registerCustomerSchema,
    registerTherapistSchema,
    loginSchema,
    requestPasswordResetSchema,
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