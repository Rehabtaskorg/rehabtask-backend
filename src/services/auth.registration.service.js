import { prisma, withAdminAccess } from "../config/prisma.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { env } from "../config/env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import {
    sendTherapistWelcome,
    sendExistingAccountNotification,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { createTrialSubscription } from "./subscription.service.js";
import { USER_ROLES, APPROVAL_STATUS, CUSTOMER_TYPES } from "../utils/constants.js";

const frontendUrl = () => (env.FRONTEND_URL || "").replace(/\/$/, "");

const generateVerificationLink = async (email, redirect = null) => {
    const auth = getIdentityPlatformAuth();
    const firebaseLink = await auth.generateEmailVerificationLink(email, {
        url: `${frontendUrl()}/verify-callback`,
    });

    const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
    if (!oobCode) throw new BadRequestError("Identity Platform did not return an oobCode");

    const base = `${frontendUrl()}/action-handler`;
    const continueUrlObj = new URL(`${frontendUrl()}/verify-callback`);
    if (redirect) continueUrlObj.searchParams.set("redirect", redirect);
    const continueUrl = continueUrlObj.toString();
    return `${base}?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}&continueUrl=${encodeURIComponent(continueUrl)}`;
};

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

export const registerCustomer = async ({ email, password, fullName, phone, smsOptIn = false, customerType, agencyName }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const auth = getIdentityPlatformAuth();
    let authUid;

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        await sendResetLink(normalizedEmail, "existing");
        return { message: "Registration successful. Please check your email for verification.", user: null };
    }

    try {
        const authUser = await auth.createUser({ email: normalizedEmail, password, emailVerified: false, displayName: fullName });
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
                            smsOptIn,
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
            return { message: "Registration successful. Please check your email for verification.", user: null };
        }

        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await sendResetLink(normalizedEmail, "reset");
            return { message: "Registration successful. Please check your email for verification.", user: null };
        }

        if (authUid) {
            auth.deleteUser(authUid).catch(() => {});
        }

        logger.error("[Auth] registerCustomer unexpected error", { email: normalizedEmail, code: error?.code, message: error?.message, stack: error?.stack });
        throw new BadRequestError("Failed to process registration. Please try again.");
    }
};

export const registerTherapist = async ({ email, password, fullName, phone, smsOptIn = false }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const auth = getIdentityPlatformAuth();
    let authUid;

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        await sendResetLink(normalizedEmail, "existing");
        return { message: "Registration successful. Please check your email and wait for admin approval.", user: null };
    }

    try {
        const authUser = await auth.createUser({ email: normalizedEmail, password, emailVerified: false, displayName: fullName });
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
                        create: { fullName, phone, smsOptIn, approvalStatus: APPROVAL_STATUS.PENDING },
                    },
                },
                include: { therapistProfile: true },
            });
        });

        return {
            user: { id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified, needsEmailVerification: true },
            message: "Registration successful. Please verify your email and wait for admin approval.",
            isNew: true,
        };
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            await sendResetLink(normalizedEmail, "existing");
            return { message: "Registration successful. Please check your email and wait for admin approval.", user: null };
        }

        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await sendResetLink(normalizedEmail, "reset");
            return { message: "Registration successful. Please check your email and wait for admin approval.", user: null };
        }

        if (authUid) {
            auth.deleteUser(authUid).catch(() => {});
        }

        throw new BadRequestError("Failed to process registration. Please try again.");
    }
};

export const requestPasswordReset = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();
    await sendResetLink(normalizedEmail, "reset");
    return { message: "If an account exists with this email, you will receive password reset instructions." };
};

export const resendVerificationEmail = async ({ email, redirect = null }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, emailVerified: true },
    });

    if (user?.emailVerified) {
        throw new BadRequestError("This email is already verified. Please log in.", "EMAIL_ALREADY_VERIFIED");
    }

    if (user) {
        try {
            const verificationLink = await generateVerificationLink(normalizedEmail, redirect);
            sendEmailVerificationEmail({ email: normalizedEmail, verificationLink }).catch((err) => {
                logger.error("[Auth] Failed to send verification email", { email: normalizedEmail, error: err.message });
            });
        } catch (err) {
            if (err?.message?.includes("TOO_MANY_ATTEMPTS")) {
                throw new BadRequestError("Please wait before requesting another verification email.", "EMAIL_RATE_LIMITED");
            }
            logger.warn("[Auth] Resend verification error", { email: normalizedEmail, error: err.message });
        }
    }

    return { message: "If an unverified account exists with this email, a verification link has been sent." };
};

export const completeOAuthOnboarding = async ({ userId, role, profileData, smsOptIn = false }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });

    if (!user) throw new NotFoundError("User not found");
    if (role === USER_ROLES.CUSTOMER && user.customerProfile) throw new ConflictError("Customer profile already exists");
    if (role === USER_ROLES.THERAPIST && user.therapistProfile) throw new ConflictError("Therapist profile already exists");

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
                            phone: profileData.phone,
                            smsOptIn,
                            customerType: profileData.customerType || "individual",
                            agencyName: profileData.customerType === CUSTOMER_TYPES.AGENCY ? profileData.agencyName : null,
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
                therapistProfile: { create: { fullName: profileData.fullName, phone: profileData.phone, smsOptIn, approvalStatus: APPROVAL_STATUS.PENDING } },
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
        sendTherapistWelcome({ therapist: { ...updatedUser.therapistProfile, user: { email: updatedUser.email } } }).catch(() => {});
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
