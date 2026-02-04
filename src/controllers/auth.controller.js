import {
    registerCustomer, registerTherapist, login, logout, getCurrentUser, requestPasswordReset, refreshAccessToken,
    resetPassword, changePassword, resendVerificationEmail, completeOAuthOnboarding,
    handleOAuth,
} from "../services/auth.service.js";
import { verifyRecaptcha } from "../utils/recaptcha.js";

/**
 * Cookie options for Supabase tokens
 */
const getAccessTokenCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 60 * 60 * 1000, // 1 hour
    path: "/",
});

const getRefreshTokenCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
});


/**
 * Register customer controller
 */
export const registerCustomerController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, customerType, agencyName, recaptchaToken } = req.body;

        // if (recaptchaToken) {
        //     const recaptchaResult = await verifyRecaptcha(recaptchaToken, req.ip || req.headers["x-forwared-for"]);

        //     if (!recaptchaResult.success) {
        //         return res.status(400).json({
        //             success: false,
        //             code: "RECAPTCHA_FAILED",
        //             message: "reCAPTCHA verification failed. Please try again."
        //         });
        //     }
        // }

        const result = await registerCustomer({ email, password, fullName, phone, customerType, agencyName })

        const response = {
            success: true,
            message: result.message
        };

        /**
         * If the user was successfully created (result.user.exists)
         * we include the non-sensitive user data in the response
         * If result.user is null (email already exists), we omit the data
         * block to prevent information leaking, but still return 201
         */
        if (result.user) {
            response.data = {
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    role: result.user.role,
                    emailVerified: result.user.emailVerified
                }
            }
        }

        return res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * Register therapist controller
 */
export const registerTherapistController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, recaptchaToken } = req.body;

        // if (recaptchaToken) {
        //     const recaptchaResult = await verifyRecaptcha(recaptchaToken, req.ip || req.headers["x-forwared-for"]);

        //     if (!recaptchaResult.success) {
        //         return res.status(400).json({
        //             success: false,
        //             code: "RECAPTCHA_FAILED",
        //             message: "reCAPTCHA verification failed. Please try again."
        //         });
        //     }
        // }

        const result = await registerTherapist({ email, password, fullName, phone });

        const response = {
            success: true,
            message: result.message,
        };

        if (result.user) {
            response.data = {
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    role: result.user.role,
                    emailVerified: result.user.emailVerified,
                    approvalStatus: result.user.therapistProfile?.approvalStatus
                }
            };
        }

        return res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * Login
 */
export const loginController = async (req, res, next) => {
    try {
        const { email, password, recaptchaToken } = req.body;

        // if (recaptchaToken) {
        //     const recaptchaResult = await verifyRecaptcha(recaptchaToken, req.ip || req.headers["x-forwared-for"]);

        //     if (!recaptchaResult.success) {
        //         return res.status(400).json({
        //             success: false,
        //             code: "RECAPTCHA_FAILED",
        //             message: "reCAPTCHA verification failed. Please try again."
        //         });
        //     }
        // }

        const result = await login({ email, password });

        // Set Supabase session tokens in httpOnly cookies
        res.cookie("sb_access_token", result.session.access_token, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refresh_token, getRefreshTokenCookieOptions());

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                user: result.user
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Logout
 */
export const logoutController = async (req, res, next) => {
    try {
        await logout(req.accessToken);

        // Clear all auth cookies
        res.clearCookie("sb_access_token", getAccessTokenCookieOptions());
        res.clearCookie("sb_refresh_token", getRefreshTokenCookieOptions());

        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get current user controller
 */
export const getCurrentUserController = async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.user.id);

        res.status(200).json({
            success: true,
            data: {
                user
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Request password reset controller
 */
export const requestPasswordResetController = async (req, res, next) => {
    try {
        const { email, recaptchaToken } = req.body;

        // if (recaptchaToken) {
        //     const recaptchaResult = await verifyRecaptcha(recaptchaToken, req.ip || req.headers["x-forwared-for"]);

        //     if (!recaptchaResult.success) {
        //         return res.status(400).json({
        //             success: false,
        //             code: "RECAPTCHA_FAILED",
        //             message: "reCAPTCHA verification failed. Please try again."
        //         });
        //     }
        // }

        const result = await requestPasswordReset({ email });

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Reset password controller
 * Called when user clicks reset link and submits new password
 */
export const resetPasswordController = async (req, res, next) => {
    try {
        const { password } = req.body;

        // Access token from reset link should be in cookies or header
        const accessToken = req.accessToken || extractTokenFromHeader(req);

        if (!accessToken) {
            return res.status(400).json({
                success: false,
                code: "INVALID_TOKEN",
                message: "Invalid or expired reset token",
            });
        }

        const result = await resetPassword({ password, accessToken });

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Change password controller (for authenticated users)
 */
export const changePasswordController = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const result = await changePassword({
            userId: req.user.id,
            currentPassword,
            newPassword
        });

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

/**
 * OAuth callback controller
 */
export const oauthCallbackController = async (req, res, next) => {
    try {
        const { code, provider } = req.query;

        if (!code && !provider) {
            return res.redirect(
                `${process.env.FRONTEND_URL}/auth/error?message=${encodeURIComponent('Missing OAuth parameters')}`
            );
        }

        const result = await handleOAuth({ code, provider });

        res.cookie("sb_access_token", result.session.access_token, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refresh_token, getRefreshTokenCookieOptions());

        const redirectUrl = result.user.needsOnboarding
            ? `${process.env.FRONTEND_URL}/auth/onboarding`
            : `${process.env.FRONTEND_URL}/dashboard`;

        res.redirect(redirectUrl);
    } catch (error) {
        console.error("OAuth callback error:", error);
        res.redirect(
            `${process.env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(error.message || 'OAuth authentication failed')}`
        );
    }
}

/**
 * Resend verification email controller
 */
export const resendVerificationEmailController = async (req, res, next) => {
    try {
        const { email, recaptchaToken } = req.body;

        // if (recaptchaToken) {
        //     const recaptchaResult = await verifyRecaptcha(recaptchaToken, req.ip || req.headers["x-forwared-for"]);

        //     if (!recaptchaResult.success) {
        //         return res.status(400).json({
        //             success: false,
        //             code: "RECAPTCHA_FAILED",
        //             message: "reCAPTCHA verification failed. Please try again."
        //         });
        //     }
        // }

        const result = await resendVerificationEmail({ email });

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Complete OAuth onboarding controller
 */
export const completeOAuthOnboardingController = async (req, res, next) => {
    try {
        const { role, ...profileData } = req.body;

        const result = await completeOAuthOnboarding({
            userId: req.user.id,
            role,
            profileData
        });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                user: result.user,
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Refresh token controller
 */
export const refreshTokenController = async (req, res, next) => {
    try {
        const refreshToken = req.cookies.sb_refresh_token || req.body.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                code: "NO_REFRESH_TOKEN",
                message: "Refresh token not found",
            });
        }

        const result = await refreshAccessToken({ refreshToken });

        // Update cookies with new tokens
        res.cookie("sb_access_token", result.session.access_token, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refresh_token, getRefreshTokenCookieOptions());

        res.status(200).json({
            success: true,
            message: "Token refreshed successfully",
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Helper to extract token from Authorization header
 */
function extractTokenFromHeader(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    return null;
}