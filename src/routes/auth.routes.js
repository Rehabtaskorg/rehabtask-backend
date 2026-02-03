import express from "express";
import {
    registerCustomerController, registerTherapistController, loginController,
    logoutController, getCurrentUserController, requestPasswordResetController,
    resetPasswordController, changePasswordController, verifyEmailController,
    resendVerificationEmailController, oauthCallbackController, completeOAuthOnboardingController,
    refreshTokenController
} from "../controllers/auth.controller.js";
import { authenticate, optionalAuthenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    registerCustomerSchema, registerTherapistSchema, loginSchema,
    requestPasswordResetSchema, resetPasswordSchema, changePasswordSchema,
    verifyEmailSchema, resendVerificationSchema, oauthCallbackSchema
} from "../validators/auth.schema.js";

const router = express.Router();

/**
 * Public routes (no authentication required)
 */

// Registration
router.post("/register/customer", validate(registerCustomerSchema), registerCustomerController);
router.post("/register/therapist", validate(registerTherapistSchema), registerTherapistController);

// Login
router.post("/login", validate(loginSchema), loginController);

// Password reset request
router.post("/password/forgot", validate(requestPasswordResetSchema), requestPasswordResetController);

// Reset password with token
router.post("/password/reset", validate(resetPasswordSchema), resetPasswordController);

// Email verification
router.post("/email/verify", validate(verifyEmailSchema), verifyEmailController);

// Resend verification email
router.post("/email/resend", validate(resendVerificationSchema), resendVerificationEmailController);

// OAuth callbacks
router.get("/oauth/callback", oauthCallbackController);

// Refresh token
router.post("/token/refresh", refreshTokenController);

/**
 * Protected routes (authentication required)
 */

// Logout
router.post("/logout", authenticate, logoutController);

// Get current user
router.get("/me", authenticate, getCurrentUserController);

// Change password (for authenticated users)
router.post("/password/change", authenticate, validate(changePasswordSchema), changePasswordController);

// Complete OAuth onboarding
router.post("/oauth/onboarding", authenticate, completeOAuthOnboardingController);

export default router;