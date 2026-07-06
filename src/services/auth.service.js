import { prisma, withAdminAccess } from "../config/prisma.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { env } from "../config/env.js";
import { AuthenticationError, ConflictError, BadRequestError, NotFoundError } from "../utils/errors.js";
import {
    sendTherapistWelcome,
    sendSubAdminWelcome,
    sendExistingAccountNotification,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { createTrialSubscription } from "./subscription.service.js";
import { USER_ROLES, APPROVAL_STATUS, CUSTOMER_TYPES } from "../utils/constants.js";

const frontendUrl = () => (env.FRONTEND_URL || "").replace(/\/$/, "");

/**
 * Generate an email verification link via the Identity Platform REST API.
 * Bypasses callbackUri (project-level, single-value) by constructing the link
 * directly from the raw oobCode — giving each environment its own handler URL.
 *
 * @param {string} email
 * @param {string} idToken - The user's Identity Platform ID token (required by sendOobCode)
 * @returns {Promise<string>} Full verification URL pointing to this environment's action handler
 */
const generateVerificationLink = async (email) => {
    const auth = getIdentityPlatformAuth();
    const firebaseLink = await auth.generateEmailVerificationLink(email, {
        url: `${frontendUrl()}/verify-callback`,
    });

    const oobCode = new URL(firebaseLink).searchParams.get("oobCode");

    if (!oobCode) {
        throw new BadRequestError("Identity Platform did not return an oobCode");
    }

    const base = `${frontendUrl()}/action-handler`;
    const continueUrl = `${frontendUrl()}/verify-callback`;
    return `${base}?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}&continueUrl=${encodeURIComponent(continueUrl)}`;
};

/**
 * Call the Identity Platform REST sign-in endpoint.
 * The Firebase Admin SDK cannot sign users in — only the REST API can.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{uid: string, idToken: string, refreshToken: string, emailVerified: boolean}>}
 */
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
 * Generate a password reset link and send it via Resend.
 * Used by: existing-account notification, P2002 fallback, forgot-password flow.
 *
 * @param {string} email
 * @param {"reset"|"existing"} type
 */
const sendResetLink = async (email, type = "reset") => {
    const auth = getIdentityPlatformAuth();
    try {
        const firebaseLink = await auth.generatePasswordResetLink(email, {
            url: `${frontendUrl()}/reset-password`,
        });

        const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
        const resetLink = `${frontendUrl()}/action-handler?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}&continueUrl=${encodeURIComponent(`${frontendUrl()}/reset-password`)}`;

        const send = type === "existing"
            ? sendExistingAccountNotification({ email, resetLink })
            : sendPasswordResetEmail({ email, resetLink });

        send.catch((err) => {
            logger.error("[Auth] Failed to send reset email", { email, type, error: err.message });
        });
    } catch (err) {
        logger.error("[Auth] Failed to generate password reset link", { email, error: err.message });
    }
};

/**
 * Register a new customer.
 *
 * @param {{email: string, password: string, fullName: string, phone: string, customerType: string, agencyName?: string}} params
 */
export const registerCustomer = async ({ email, password, fullName, phone, customerType, agencyName }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const auth = getIdentityPlatformAuth();
    let authUid;

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        await sendResetLink(normalizedEmail, "existing");
        return {
            message: "Registration successful. Please check your email for verification.",
            user: null,
        };
    }

    try {
        const authUser = await auth.createUser({
            email: normalizedEmail,
            password,
            emailVerified: false,
            displayName: fullName,
        });

        authUid = authUser.uid;

        const verificationLink = await generateVerificationLink(normalizedEmail);

        sendEmailVerificationEmail({ email: normalizedEmail, verificationLink }).catch((err) => {
            logger.error("[Auth] Failed to send verification email", { email: normalizedEmail, error: err.message });
        });

        const existingPatient = await prisma.patient.findFirst({
            where: { email: normalizedEmail, userId: null },
            include: { agency: { select: { id: true, fullName: true, agencyName: true } } },
        });

        const user = await withAdminAccess(async (db) => {
            const createdUser = await db.user.create({
                data: {
                    id: authUid,
                    email: normalizedEmail,
                    passwordHash: "",
                    role: USER_ROLES.CUSTOMER,
                    emailVerified: false,
                    isActive: true,
                    customerProfile: {
                        create: {
                            fullName,
                            phone,
                            customerType,
                            agencyName: customerType === CUSTOMER_TYPES.AGENCY ? agencyName : null,
                        },
                    },
                    ...(existingPatient && { patientProfile: { connect: { id: existingPatient.id } } }),
                },
                include: { customerProfile: true },
            });

            await createTrialSubscription(createdUser.customerProfile.id, db);
            return createdUser;
        });

        let message = "Registration successful. Please check your email to verify your account.";
        if (existingPatient) {
            message += ` Your account has been linked to ${existingPatient.agency.agencyName || "an agency"}.`;
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                needsEmailVerification: true,
                hasLinkedRecords: Boolean(existingPatient),
            },
            message,
        };
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            await sendResetLink(normalizedEmail, "existing");
            return {
                message: "Registration successful. Please check your email for verification.",
                user: null,
            };
        }

        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await sendResetLink(normalizedEmail, "reset");
            return {
                message: "Registration successful. Please check your email for verification.",
                user: null,
            };
        }

        if (authUid) {
            auth.deleteUser(authUid).catch(() => {});
        }

        logger.error("[Auth] registerCustomer unexpected error", { email: normalizedEmail, code: error?.code, message: error?.message, stack: error?.stack });
        throw new BadRequestError("Failed to process registration. Please try again.");
    }
};

/**
 * Register a new therapist.
 *
 * @param {{email: string, password: string, fullName: string, phone: string}} params
 */
export const registerTherapist = async ({ email, password, fullName, phone }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const auth = getIdentityPlatformAuth();
    let authUid;

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        await sendResetLink(normalizedEmail, "existing");
        return {
            message: "Registration successful. Please check your email and wait for admin approval.",
            user: null,
        };
    }

    try {
        const authUser = await auth.createUser({
            email: normalizedEmail,
            password,
            emailVerified: false,
            displayName: fullName,
        });

        authUid = authUser.uid;

        const verificationLink = await generateVerificationLink(normalizedEmail);

        sendEmailVerificationEmail({ email: normalizedEmail, verificationLink }).catch((err) => {
            logger.error("[Auth] Failed to send verification email", { email: normalizedEmail, error: err.message });
        });

        const user = await withAdminAccess(async (db) => {
            return db.user.create({
                data: {
                    id: authUid,
                    email: normalizedEmail,
                    passwordHash: "",
                    role: USER_ROLES.THERAPIST,
                    emailVerified: false,
                    isActive: true,
                    therapistProfile: {
                        create: {
                            fullName,
                            phone,
                            approvalStatus: APPROVAL_STATUS.PENDING,
                        },
                    },
                },
                include: { therapistProfile: true },
            });
        });

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                needsEmailVerification: true,
            },
            message: "Registration successful. Please verify your email and wait for admin approval.",
            isNew: true,
        };
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            await sendResetLink(normalizedEmail, "existing");
            return {
                message: "Registration successful. Please check your email and wait for admin approval.",
                user: null,
            };
        }

        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await sendResetLink(normalizedEmail, "reset");
            return {
                message: "Registration successful. Please check your email and wait for admin approval.",
                user: null,
            };
        }

        if (authUid) {
            auth.deleteUser(authUid).catch(() => {});
        }

        throw new BadRequestError("Failed to process registration. Please try again.");
    }
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
    const user = await prisma.user.findUnique({
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
    });

    if (!user) throw new NotFoundError("User not found");

    return {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        isActive: user.isActive,
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
 * Send a password reset email.
 * Non-enumerating — always returns success regardless of whether the email exists.
 *
 * @param {{email: string}} params
 */
export const requestPasswordReset = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();
    await sendResetLink(normalizedEmail, "reset");
    return {
        message: "If an account exists with this email, you will receive password reset instructions.",
    };
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
 * Resend the email verification link.
 * Guards against sending when the account is already verified.
 *
 * @param {{email: string}} params
 */
export const resendVerificationEmail = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, emailVerified: true },
    });

    if (user?.emailVerified) {
        throw new BadRequestError(
            "This email is already verified. Please log in.",
            "EMAIL_ALREADY_VERIFIED"
        );
    }

    if (user) {
        try {
            const verificationLink = await generateVerificationLink(normalizedEmail);
            sendEmailVerificationEmail({ email: normalizedEmail, verificationLink }).catch((err) => {
                logger.error("[Auth] Failed to send verification email", { email: normalizedEmail, error: err.message });
            });
        } catch (err) {
            if (err?.message?.includes("TOO_MANY_ATTEMPTS")) {
                throw new BadRequestError(
                    "Please wait before requesting another verification email.",
                    "EMAIL_RATE_LIMITED"
                );
            }
            logger.warn("[Auth] Resend verification error", { email: normalizedEmail, error: err.message });
        }
    }

    return {
        message: "If an unverified account exists with this email, a verification link has been sent.",
    };
};

/**
 * Complete OAuth onboarding — assigns role and creates profile after OAuth sign-in.
 *
 * @param {{userId: string, role: string, profileData: object}} params
 */
export const completeOAuthOnboarding = async ({ userId, role, profileData }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });

    if (!user) throw new NotFoundError("User not found");

    if (role === USER_ROLES.CUSTOMER && user.customerProfile) {
        throw new ConflictError("Customer profile already exists");
    }

    if (role === USER_ROLES.THERAPIST && user.therapistProfile) {
        throw new ConflictError("Therapist profile already exists");
    }

    const existingPatient = await prisma.patient.findFirst({
        where: { email: user.email, userId: null },
        include: { agency: { select: { id: true, fullName: true, agencyName: true } } },
    });

    const updatedUser = await withAdminAccess(async (db) => {
        if (role === USER_ROLES.CUSTOMER) {
            const updated = await db.user.update({
                where: { id: userId },
                data: {
                    role: USER_ROLES.CUSTOMER,
                    customerProfile: {
                        create: {
                            fullName: profileData.fullName,
                            phone: profileData.phone || null,
                            customerType: profileData.customerType || "individual",
                            agencyName:
                                profileData.customerType === CUSTOMER_TYPES.AGENCY
                                    ? profileData.agencyName
                                    : null,
                        },
                    },
                    ...(existingPatient && { patientProfile: { connect: { id: existingPatient.id } } }),
                },
                include: { customerProfile: true },
            });

            await createTrialSubscription(updated.customerProfile.id, db);
            return updated;
        }

        return db.user.update({
            where: { id: userId },
            data: {
                role: USER_ROLES.THERAPIST,
                therapistProfile: {
                    create: {
                        fullName: profileData.fullName,
                        phone: profileData.phone || null,
                        approvalStatus: APPROVAL_STATUS.PENDING,
                    },
                },
            },
            include: { therapistProfile: true },
        });
    });

    let message = "Profile completed successfully";

    if (role === USER_ROLES.CUSTOMER && existingPatient) {
        message += `. Your account has been linked to ${existingPatient.agency.agencyName || "an agency"}.`;
    }

    if (role === USER_ROLES.THERAPIST) {
        message += ". Your account is pending admin approval.";
        sendTherapistWelcome({
            therapist: { ...updatedUser.therapistProfile, user: { email: updatedUser.email } },
        }).catch(() => {});
    }

    return {
        user: {
            id: updatedUser.id,
            email: updatedUser.email,
            role: updatedUser.role,
            emailVerified: updatedUser.emailVerified,
            onboardingComplete: true,
            hasLinkedRecords: Boolean(existingPatient),
        },
        message,
    };
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
