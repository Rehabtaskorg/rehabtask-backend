import { prisma, withAdminAccess } from "../config/prisma.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { env } from "../config/env.js";
import { AuthenticationError, BadRequestError, NotFoundError } from "../utils/errors.js";
import { sendTherapistWelcome, sendSubAdminWelcome } from "./email.service.js";
import { logger } from "../config/logger.js";
import { USER_ROLES } from "../utils/constants.js";
export {
    registerCustomer,
    registerTherapist,
    requestPasswordReset,
    resendVerificationEmail,
    completeOAuthOnboarding,
} from "./auth.registration.service.js";

const signInWithPassword = async (email, password) => {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_WEB_API_KEY}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email,
            password,
            tenantId: env.IDENTITY_PLATFORM_TENANT_ID,
            returnSecureToken: true,
        }),
    });

    const body = await res.json();

    if (!res.ok) {
        throw { _ipCode: body?.error?.message };
    }

    const payload = JSON.parse(Buffer.from(body.idToken.split(".")[1], "base64url").toString());

    return {
        uid: body.localId,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        emailVerified: payload.email_verified === true,
    };
};

/**
 * Call the Identity Platform secure token refresh endpoint.
 *
 * @param {string} refreshToken
 * @returns {Promise<{idToken: string, refreshToken: string, uid: string}>}
 */
const exchangeRefreshToken = async (refreshToken) => {
    const url = `https://securetoken.googleapis.com/v1/token?key=${env.FIREBASE_WEB_API_KEY}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });

    const body = await res.json();

    if (!res.ok) {
        throw new AuthenticationError("Failed to refresh token", "TOKEN_REFRESH_FAILED");
    }

    return {
        idToken: body.id_token,
        refreshToken: body.refresh_token,
        uid: body.user_id,
    };
};

/**
 * Login with email and password.
 *
 * @param {{email: string, password: string}} params
 */
export const login = async ({ email, password }) => {
    const normalizedEmail = email.toLowerCase().trim();

    let ipUser;
    try {
        ipUser = await signInWithPassword(normalizedEmail, password);
    } catch (err) {
        if (err._ipCode === "EMAIL_NOT_VERIFIED") {
            throw new AuthenticationError(
                "Please verify your email address before logging in. Check your inbox for the verification link.",
                "EMAIL_NOT_VERIFIED"
            );
        }
        throw new AuthenticationError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    if (!ipUser.emailVerified) {
        throw new AuthenticationError(
            "Please verify your email address before logging in. Check your inbox for the verification link.",
            "EMAIL_NOT_VERIFIED"
        );
    }

    const user = await prisma.user.findUnique({
        where: { id: ipUser.uid },
        include: {
            customerProfile: true,
            therapistProfile: true,
            subAdminProfile: true,
        },
    });

    if (!user || !user.isActive) {
        throw new NotFoundError("User account not found", "USER_NOT_FOUND");
    }

    if (!user.emailVerified) {
        await withAdminAccess(async (db) => {
            await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
        });
        user.emailVerified = true;
    }

    return {
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            emailVerified: user.emailVerified,
            isActive: user.isActive,
        },
        session: {
            accessToken: ipUser.idToken,
            refreshToken: ipUser.refreshToken,
        },
    };
};

/**
 * Logout — cookies are cleared by the controller.
 * Identity Platform tokens are stateless JWTs — no server-side session to revoke.
 *
 * @returns {{success: boolean}}
 */
export const logout = async () => {
    return { success: true };
};

/**
 * Get the current authenticated user by ID.
 *
 * @param {string} userId
 */
export const getCurrentUser = async (userId) => {
    const [user, agreementAcceptance] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                emailVerified: true,
                isActive: true,
                customerProfile: {
                    select: {
                        fullName: true,
                        customerType: true,
                        agencyName: true,
                        onboardingComplete: true,
                        onboardingStep: true,
                        approvalStatus: true,
                    },
                },
                therapistProfile: {
                    select: {
                        fullName: true,
                        approvalStatus: true,
                        rejectionReason: true,
                        profilePhotoUrl: true,
                        onboardingStep: true,
                        onboardingComplete: true,
                        ratePerVisit: true,
                        attemptedVisitRate: true,
                        primaryLicenseType: true,
                    },
                },
                subAdminProfile: {
                    select: {
                        permissions: true,
                        isActive: true,
                    },
                },
            },
        }),
        prisma.unifiedAgreementAcceptance.findFirst({
            where: { userId },
            select: { agreementVersion: true },
            orderBy: { acceptedAt: "desc" },
        }),
    ]);

    if (!user) throw new NotFoundError("User not found");

    return {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        isActive: user.isActive,
        hasAcceptedAgreement: agreementAcceptance !== null,
        profile:
            user.role === USER_ROLES.CUSTOMER
                ? user.customerProfile
                : user.role === USER_ROLES.THERAPIST
                ? user.therapistProfile
                : user.role === USER_ROLES.SUB_ADMIN
                ? user.subAdminProfile
                : null,
    };
};

/**
 * Mark a user as email-verified in the database.
 * Called by the frontend after the Firebase email verification link is actioned.
 * Sends welcome email to therapists and sub-admins on first verification.
 *
 * @param {{userId?: string, email?: string, fullName?: string}} params
 */
export const markEmailVerified = async ({ userId, email, fullName }) => {
    if (!userId && !email) throw new BadRequestError("User ID or email is required");

    try {
        const whereClause = userId ? { id: userId } : { email: email.toLowerCase().trim() };

        const user = await prisma.user.findUnique({
            where: whereClause,
            select: {
                id: true,
                email: true,
                role: true,
                emailVerified: true,
                therapistProfile: { select: { id: true, fullName: true } },
                customerProfile: { select: { id: true, fullName: true } },
            },
        });

        if (!user) throw new NotFoundError("User not found");

        const wasAlreadyVerified = user.emailVerified;

        await withAdminAccess(async (db) => {
            await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });

            if (user.role === USER_ROLES.SUB_ADMIN && fullName?.trim()) {
                await db.subAdminProfile.update({
                    where: { userId: user.id },
                    data: { fullName: fullName.trim() },
                });
            }
        });

        if (!wasAlreadyVerified && user.role === USER_ROLES.THERAPIST && user.therapistProfile) {
            sendTherapistWelcome({
                therapist: { ...user.therapistProfile, user: { email: user.email } },
            }).catch(() => {});
        }

        if (!wasAlreadyVerified && user.role === USER_ROLES.SUB_ADMIN) {
            sendSubAdminWelcome({ user }).catch(() => {});
        }

        const profile = user.therapistProfile || user.customerProfile || null;

        return {
            message: "Email verified in database",
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                fullName: profile?.fullName || null,
            },
        };
    } catch (error) {
        logger.error("[Auth] Error updating emailVerified", { userId, email, error: error.message });
        throw new BadRequestError("Failed to update user email verification");
    }
};

/**
 * Change password for an authenticated user.
 * Verifies the current password via Identity Platform before updating.
 *
 * @param {{userId: string, currentPassword: string, newPassword: string}} params
 */
export const changePassword = async ({ userId, currentPassword, newPassword }) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");

    try {
        await signInWithPassword(user.email, currentPassword);
    } catch {
        throw new AuthenticationError("Current password is incorrect", "INVALID_PASSWORD");
    }

    const auth = getIdentityPlatformAuth();
    await auth.updateUser(userId, { password: newPassword });

    return { message: "Password changed successfully" };
};

/**
 * Refresh the access token using a refresh token.
 *
 * @param {{refreshToken: string}} params
 */
export const refreshAccessToken = async ({ refreshToken }) => {
    let tokens;
    try {
        tokens = await exchangeRefreshToken(refreshToken);
    } catch (err) {
        logger.error("[Auth] Token refresh error", { error: err.message });
        throw new AuthenticationError("Failed to refresh token", "TOKEN_REFRESH_FAILED");
    }

    const user = await prisma.user.findUnique({
        where: { id: tokens.uid },
        select: { isActive: true, role: true },
    });

    if (!user || !user.isActive) {
        throw new AuthenticationError("Your account has been deactivated", "ACCOUNT_DEACTIVATED");
    }

    return {
        session: {
            access_token: tokens.idToken,
            refresh_token: tokens.refreshToken,
        },
        role: user.role,
    };
};
