import { prisma, withAdminAccess } from "../config/prisma.js";
import { supabase } from "../config/supabase.js";
import {
    registerCustomer, registerTherapist, login, logout, getCurrentUser, requestPasswordReset, refreshAccessToken,
    changePassword, resendVerificationEmail, completeOAuthOnboarding, markEmailVerified,
} from "../services/auth.service.js";

/**
 * Whether cookies should use secure/cross-origin settings
 * Driven by COOKIE_SECURE env var so it works indepentely of NODE_ENV
 * Set COOKIE_SECURE=true on any deployment that serves over HTTPS (staging, production)
 * Leave unset for local dev (HTTP localhost)
 */

const isSecureContext = process.env.COOKIE_SECURE === "true";

const getAccessTokenCookieOptions = () => {
    return {
        httpOnly: true,
        secure: isSecureContext,
        sameSite: isSecureContext ? "none" : "lax", // "none" for cross-origin
        maxAge: 60 * 60 * 1000,
        path: "/",
    };
};

const getRefreshTokenCookieOptions = () => ({
    httpOnly: true,
    secure: isSecureContext,
    sameSite: isSecureContext ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
});

/**
 * Register customer controller
 */
export const registerCustomerController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, customerType, agencyName } = req.body;

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
                    emailVerified: result.user.emailVerified,
                    hasLinkedRecords: result.user.hasLinkedRecords
                }
            };
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
        const { email, password, fullName, phone } = req.body;

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
        const { email, password } = req.body;

        const result = await login({ email, password });

        // Set Supabase session tokens in httpOnly cookies
        res.cookie("sb_access_token", result.session.accessToken, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refreshToken, getRefreshTokenCookieOptions());

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

        // Clear all auth cookies — attributes must match the original Set-Cookie to ensure deletion
        const isSecureContext = process.env.COOKIE_SECURE === "true";
        const clearOptions = {
            path: "/",
            httpOnly: true,
            secure: isSecureContext,
            sameSite: isSecureContext ? "none" : "lax",
        };

        res.clearCookie("sb_access_token", clearOptions);
        res.clearCookie("sb_refresh_token", clearOptions);

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
 * Handle email verification callback from frontend
 */
export const verifyEmailController = async (req, res, next) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Missing userId"
            });
        }

        const result = await markEmailVerified({ userId });

        res.status(200).json({
            success: true,
            message: result.message
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
        const { email } = req.body;

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
 * Complete OAuth onboarding controller
 */
export const completeOAuthOnboardingController = async (req, res, next) => {
    try {
        const { role, fullName, phone, customerType, agencyName, location } = req.body;

        // Build profile data object based on role
        const profileData = {
            fullName,
            phone,
            ...(role === "customer" && {
                customerType,
                agencyName,
                location
            }),
        };

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
 * Process OAuth session from frontend
 * Called after frontend receives tokens from Supabase
 */
export const processOAuthController = async (req, res, next) => {
    try {
        const { accessToken, refreshToken } = req.body;

        if (!accessToken || !refreshToken) {
            return res.status(400).json({
                success: false,
                message: "Missing OAuth tokens"
            });
        }

        // Verify the session with Supabase and get user
        const { data: { user: supabaseUser }, error: userError } = await supabase.auth.getUser(accessToken);

        if (userError || !supabaseUser) {
            return res.status(401).json({
                success: false,
                message: "Invalid OAuth session"
            });
        }

        // Check if user exists in our database
        let user = await prisma.user.findUnique({
            where: { id: supabaseUser.id },
            include: {
                customerProfile: true,
                therapistProfile: true,
            },
        });

        // If user doesn't exists, create a minimal user record
        if (!user) {
            // Check if this email was already registered as a patient
            const existingPatient = await prisma.patient.findFirst({
                where: {
                    email: supabaseUser.email.toLowerCase().trim(),
                    userId: null
                },
                include: {
                    agency: {
                        select: {
                            id: true,
                            fullName: true,
                            agencyName: true
                        }
                    }
                }
            });

            user = await withAdminAccess(async (db) => {
                return db.user.create({
                    data: {
                        id: supabaseUser.id,
                        email: supabaseUser.email.toLowerCase().trim(),
                        passwordHash: "",
                        role: "customer",
                        emailVerified: true,
                        isActive: true,
                        ...(existingPatient && {
                            patientProfile: {
                                connect: { id: existingPatient.id }
                            }
                        })
                    },
                    include: {
                        customerProfile: true,
                        therapistProfile: true,
                    }
                });
            });

            // Set session cookies
            res.cookie("sb_access_token", accessToken, getAccessTokenCookieOptions());
            res.cookie("sb_refresh_token", refreshToken, getRefreshTokenCookieOptions());

            return res.status(200).json({
                success: true,
                message: "OAuth authentication successful",
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                        emailVerified: user.emailVerified,
                        needsOnboarding: true,
                        hasLinkedRecords: Boolean(existingPatient)
                    }
                }
            });
        }

        // Existing user - check if they need onboarding
        const needsOnboarding = user.role === "customer"
            ? !user.customerProfile
            : user.role === "therapist"
                ? !user.therapistProfile
                : false;

        // Set session cookies
        res.cookie("sb_access_token", accessToken, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", refreshToken, getRefreshTokenCookieOptions());

        res.status(200).json({
            success: true,
            message: "OAuth authentication successful",
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    emailVerified: user.emailVerified,
                    isActive: user.isActive,
                    needsOnboarding
                }
            }
        });

    } catch (error) {
        console.error("Process OAuth error:", error);
        next(error);
    }
}

/**
 * Resend verification email controller
 */
export const resendVerificationEmailController = async (req, res, next) => {
    try {
        const { email } = req.body;

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