import { prisma, withAdminAccess } from "../config/prisma.js";
import { COOKIE_MAX_AGE } from "../utils/constants.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import {
    registerCustomer, registerTherapist, login, logout, getCurrentUser, requestPasswordReset,
    refreshAccessToken, changePassword, resendVerificationEmail, completeOAuthOnboarding, markEmailVerified,
} from "../services/auth.service.js";

const isSecureContext = process.env.COOKIE_SECURE === "true";

const getAccessTokenCookieOptions = () => ({
    httpOnly: true,
    secure: isSecureContext,
    sameSite: isSecureContext ? "none" : "lax",
    maxAge: COOKIE_MAX_AGE.ONE_HOUR,
    path: "/",
});

const getRefreshTokenCookieOptions = () => ({
    httpOnly: true,
    secure: isSecureContext,
    sameSite: isSecureContext ? "none" : "lax",
    maxAge: COOKIE_MAX_AGE.SEVEN_DAYS,
    path: "/",
});

const getRoleCookieOptions = () => ({
    httpOnly: false,
    secure: isSecureContext,
    sameSite: isSecureContext ? "none" : "lax",
    maxAge: COOKIE_MAX_AGE.SEVEN_DAYS,
    path: "/",
});

/**
 * @type {import("express").RequestHandler}
 */
export const registerCustomerController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, customerType, agencyName } = req.body;
        const result = await registerCustomer({ email, password, fullName, phone, customerType, agencyName });

        const response = { success: true, message: result.message };

        if (result.user) {
            response.data = {
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    role: result.user.role,
                    emailVerified: result.user.emailVerified,
                    hasLinkedRecords: result.user.hasLinkedRecords,
                },
            };
        }

        return res.status(201).json(response);
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const registerTherapistController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone } = req.body;
        const result = await registerTherapist({ email, password, fullName, phone });

        const response = { success: true, message: result.message };

        if (result.user) {
            response.data = {
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    role: result.user.role,
                    emailVerified: result.user.emailVerified,
                },
            };
        }

        return res.status(201).json(response);
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const loginController = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await login({ email, password });

        res.cookie("sb_access_token", result.session.accessToken, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refreshToken, getRefreshTokenCookieOptions());
        res.cookie("app_role", result.user.role, getRoleCookieOptions());

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: { user: result.user },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const logoutController = async (req, res, next) => {
    try {
        await logout();

        const clearOptions = {
            path: "/",
            httpOnly: true,
            secure: isSecureContext,
            sameSite: isSecureContext ? "none" : "lax",
        };

        res.clearCookie("sb_access_token", clearOptions);
        res.clearCookie("sb_refresh_token", clearOptions);
        res.clearCookie("app_role", { path: "/", secure: isSecureContext, sameSite: isSecureContext ? "none" : "lax" });

        res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const getCurrentUserController = async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.user.id);
        res.status(200).json({ success: true, data: { user } });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const verifyEmailController = async (req, res, next) => {
    try {
        const { userId, email, fullName } = req.body;

        if (!userId && !email) {
            return res.status(400).json({ success: false, message: "Missing userId or email" });
        }

        const result = await markEmailVerified({ userId, email, fullName });
        res.status(200).json({ success: true, message: result.message, data: { user: result.user } });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const requestPasswordResetController = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await requestPasswordReset({ email });
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const changePasswordController = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = await changePassword({ userId: req.user.id, currentPassword, newPassword });
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const completeOAuthOnboardingController = async (req, res, next) => {
    try {
        const { role, fullName, phone, customerType, agencyName, location } = req.body;

        const profileData = {
            fullName,
            phone,
            ...(role === "customer" && { customerType, agencyName, location }),
        };

        const result = await completeOAuthOnboarding({ userId: req.user.id, role, profileData });

        res.status(200).json({
            success: true,
            message: result.message,
            data: { user: result.user },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Process an OAuth ID token from the frontend.
 * Verifies the token via Identity Platform, then finds or creates the Prisma user record.
 *
 * @type {import("express").RequestHandler}
 */
export const processOAuthController = async (req, res, next) => {
    try {
        const { accessToken, refreshToken } = req.body;

        if (!accessToken || !refreshToken) {
            return res.status(400).json({ success: false, message: "Missing OAuth tokens" });
        }

        const auth = getIdentityPlatformAuth();
        let decoded;
        try {
            decoded = await auth.verifyIdToken(accessToken);
        } catch {
            return res.status(401).json({ success: false, message: "Invalid OAuth session" });
        }

        const uid = decoded.uid;
        const normalizedEmail = decoded.email?.toLowerCase().trim();

        let user = await prisma.user.findUnique({
            where: { id: uid },
            include: { customerProfile: true, therapistProfile: true },
        });

        if (!user && normalizedEmail) {
            const existingByEmail = await prisma.user.findUnique({
                where: { email: normalizedEmail },
                include: { customerProfile: true, therapistProfile: true },
            });

            if (existingByEmail) {
                user = await withAdminAccess(async (db) => {
                    return db.user.update({
                        where: { email: normalizedEmail },
                        data: { id: uid, emailVerified: true },
                        include: { customerProfile: true, therapistProfile: true },
                    });
                });
            } else {
                const existingPatient = await prisma.patient.findFirst({
                    where: { email: normalizedEmail, userId: null },
                    include: { agency: { select: { id: true, fullName: true, agencyName: true } } },
                });

                user = await withAdminAccess(async (db) => {
                    return db.user.create({
                        data: {
                            id: uid,
                            email: normalizedEmail,
                            passwordHash: "",
                            role: "customer",
                            emailVerified: true,
                            isActive: true,
                            ...(existingPatient && { patientProfile: { connect: { id: existingPatient.id } } }),
                        },
                        include: { customerProfile: true, therapistProfile: true },
                    });
                });
            }

            const needsOnboarding = user.role === "customer"
                ? !user.customerProfile
                : user.role === "therapist"
                ? !user.therapistProfile
                : false;

            res.cookie("sb_access_token", accessToken, getAccessTokenCookieOptions());
            res.cookie("sb_refresh_token", refreshToken, getRefreshTokenCookieOptions());
            res.cookie("app_role", user.role, getRoleCookieOptions());

            return res.status(200).json({
                success: true,
                message: "OAuth authentication successful",
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                        emailVerified: user.emailVerified,
                        needsOnboarding,
                    },
                },
            });
        }

        if (!user?.isActive) {
            return res.status(401).json({
                success: false,
                code: "ACCOUNT_DEACTIVATED",
                message: "Your account has been deactivated. Please contact support.",
            });
        }

        const needsOnboarding = user.role === "customer"
            ? !user.customerProfile
            : user.role === "therapist"
            ? !user.therapistProfile
            : false;

        res.cookie("sb_access_token", accessToken, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", refreshToken, getRefreshTokenCookieOptions());
        res.cookie("app_role", user.role, getRoleCookieOptions());

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
                    needsOnboarding,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const resendVerificationEmailController = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await resendVerificationEmail({ email });
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        next(error);
    }
};

/**
 * @type {import("express").RequestHandler}
 */
export const refreshTokenController = async (req, res, next) => {
    try {
        const refreshToken = req.cookies?.sb_refresh_token || req.body?.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                code: "NO_REFRESH_TOKEN",
                message: "Refresh token not found",
            });
        }

        const result = await refreshAccessToken({ refreshToken });

        res.cookie("sb_access_token", result.session.access_token, getAccessTokenCookieOptions());
        res.cookie("sb_refresh_token", result.session.refresh_token, getRefreshTokenCookieOptions());

        if (result.role) {
            res.cookie("app_role", result.role, getRoleCookieOptions());
        }

        res.status(200).json({ success: true, message: "Token refreshed successfully" });
    } catch (error) {
        next(error);
    }
};
