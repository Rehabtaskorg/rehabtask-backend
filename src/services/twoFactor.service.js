import crypto from "node:crypto";
import { prisma } from "../config/prisma.js";
import { sendEmail } from "../config/email.js";
import { sendSms } from "./sms.service.js";
import { logAction } from "./audit.service.js";
import { AuthenticationError, BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const createOtp = () => crypto.randomInt(100000, 1000000).toString();
const createToken = () => crypto.randomBytes(32).toString("hex");
const safeEqual = (left, right) => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const maskEmail = (email) => {
    const [name, domain] = email.split("@");
    return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
};
const maskPhone = (phone) => `••• ••• ${phone.slice(-4)}`;

const getSettings = async (userId) => prisma.userSecuritySettings.findUnique({ where: { userId } });

const getPhone = (user, settings) => settings?.phoneNumber || user.therapistProfile?.phone || user.customerProfile?.phone || null;

const getMethods = (user, settings) => ({
    email: Boolean(user.emailVerified && settings?.emailTwoFactorEnabled),
    sms: Boolean(settings?.smsTwoFactorEnabled && settings.phoneVerifiedAt && getPhone(user, settings)),
});

/** Prefer SMS whenever a phone method is enabled; otherwise email. */
const resolvePreferredMethod = (methods, settings = null, requested = null) => {
    if (requested && methods[requested]) return requested;
    if (methods.sms) return "sms";
    if (methods.email) return "email";
    if (settings?.preferredMethod && methods[settings.preferredMethod]) return settings.preferredMethod;
    return "email";
};

const listAvailableMethods = (methods) => ["sms", "email"].filter((method) => methods[method]);

const sendCode = async ({ user, method, code, destination }) => {
    if (method === "email") {
        const result = await sendEmail({
            to: user.email,
            subject: "Your RehabTask verification code",
            text: `Your RehabTask verification code is ${code}.\n\nThis code expires in 10 minutes. Do not share this code with anyone.`,
            html: `<p>Your RehabTask verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes. Do not share this code with anyone.</p>`,
        });
        if (!result.success) throw new Error("Email provider failed");
        return;
    }

    await sendSms({
        to: destination,
        body: `Your RehabTask verification code is ${code}. This code expires in 10 minutes. Do not share this code with anyone.`,
        requireDelivery: true,
    });
};

const enforceSendLimits = async ({ userId, method, ipAddress = null, destinationReference = null }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - SEND_WINDOW_MS);

    const latest = await prisma.twoFactorChallenge.findFirst({
        where: { userId, method, createdAt: { gte: windowStart } },
        orderBy: { createdAt: "desc" },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new ConflictError("Please wait before requesting another verification code", "2FA_RESEND_COOLDOWN");
    }

    const userMethodCount = await prisma.twoFactorChallenge.count({
        where: { userId, method, createdAt: { gte: windowStart } },
    });
    if (userMethodCount >= MAX_SENDS_PER_WINDOW) {
        throw new ConflictError("Too many verification code requests. Please try again later.", "2FA_SEND_LIMIT");
    }

    if (ipAddress) {
        const ipCount = await prisma.twoFactorChallenge.count({
            where: { ipAddress, createdAt: { gte: windowStart } },
        });
        if (ipCount >= MAX_SENDS_PER_WINDOW * 3) {
            throw new ConflictError("Too many verification code requests from this network. Please try again later.", "2FA_IP_SEND_LIMIT");
        }
    }

    if (destinationReference) {
        const destinationCount = await prisma.twoFactorChallenge.count({
            where: { destinationReference, createdAt: { gte: windowStart } },
        });
        if (destinationCount >= MAX_SENDS_PER_WINDOW) {
            throw new ConflictError("Too many verification code requests for this destination. Please try again later.", "2FA_DESTINATION_SEND_LIMIT");
        }
    }
};

export const getTwoFactorStatus = async (user) => {
    const settings = await getSettings(user.id);
    const methods = getMethods(user, settings);
    const phone = getPhone(user, settings);
    return {
        enabled: Boolean(settings?.twoFactorEnabled),
        mandatory: user.role === "admin",
        recommended: user.role === "therapist",
        preferredMethod: resolvePreferredMethod(methods, settings),
        methods: {
            email: {
                enabled: methods.email,
                available: Boolean(user.emailVerified),
                destination: user.emailVerified ? maskEmail(user.email) : null,
            },
            sms: {
                enabled: methods.sms,
                available: Boolean(phone),
                destination: phone ? maskPhone(phone) : null,
                reusable: Boolean(phone) && !methods.sms,
            },
        },
        lastVerifiedAt: settings?.lastTwoFactorVerifiedAt || null,
    };
};

export const createChallenge = async ({ user, method, purpose = "login", phoneNumber = null, ipAddress = null, userAgent = null }) => {
    const settings = await getSettings(user.id);
    const methods = getMethods(user, settings);
    const destination = method === "email" ? user.email : phoneNumber || getPhone(user, settings);
    if (method === "email" && !user.emailVerified) throw new BadRequestError("A verified email is required for two-factor authentication", "2FA_EMAIL_UNVERIFIED");
    if (method === "sms" && !destination) throw new BadRequestError("A verified phone number is required for SMS authentication", "2FA_PHONE_REQUIRED");
    if (method === "sms" && !/^\+1\d{10}$/.test(destination)) throw new BadRequestError("Enter a valid US phone number in +1XXXXXXXXXX format", "2FA_PHONE_INVALID");
    if (purpose === "login" && !methods[method]) {
        throw new BadRequestError("That verification method is not enabled", "2FA_METHOD_UNAVAILABLE");
    }

    const destinationReference = method === "email" ? maskEmail(destination) : maskPhone(destination);
    await enforceSendLimits({ userId: user.id, method, ipAddress, destinationReference });
    const code = createOtp();
    const challengeToken = createToken();
    const challenge = await prisma.twoFactorChallenge.create({
        data: {
            userId: user.id,
            method,
            destinationReference,
            codeHash: hash(code),
            challengeTokenHash: hash(challengeToken),
            expiresAt: new Date(Date.now() + OTP_TTL_MS),
            ipAddress,
            userAgent,
        },
    });

    try {
        await sendCode({ user, method, code, destination });
    } catch (error) {
        await prisma.twoFactorChallenge.update({ where: { id: challenge.id }, data: { status: "failed" } });
        throw new BadRequestError(`We couldn't send a verification code by ${method}. Try again or use another verified method.`, "2FA_DELIVERY_FAILED");
    }

    await logAction({ actorId: user.id, action: "2fa.otp_sent", entityType: "two_factor_challenge", entityId: challenge.id, changes: { method, purpose } });
    return {
        challengeId: challenge.id,
        challengeToken,
        method,
        destination: challenge.destinationReference,
        expiresAt: challenge.expiresAt,
        availableMethods: listAvailableMethods(methods),
    };
};

const findPendingChallenge = async (challengeId, challengeToken) => {
    const challenge = await prisma.twoFactorChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.status !== "pending") throw new AuthenticationError("This verification challenge is no longer valid", "2FA_CHALLENGE_INVALID");
    if (!safeEqual(hash(challengeToken), challenge.challengeTokenHash)) throw new AuthenticationError("This verification challenge is no longer valid", "2FA_CHALLENGE_INVALID");
    if (challenge.expiresAt < new Date()) {
        await prisma.twoFactorChallenge.update({ where: { id: challenge.id }, data: { status: "expired" } });
        throw new AuthenticationError("This verification code has expired. Request a new code.", "2FA_CODE_EXPIRED");
    }
    if (challenge.attemptCount >= MAX_ATTEMPTS) throw new AuthenticationError("Too many verification attempts. Request a new code.", "2FA_TOO_MANY_ATTEMPTS");
    return challenge;
};

export const verifyChallenge = async ({ challengeId, challengeToken, code, purpose = "login" }) => {
    const challenge = await findPendingChallenge(challengeId, challengeToken);
    if (!safeEqual(hash(code), challenge.codeHash)) {
        const attemptCount = challenge.attemptCount + 1;
        await prisma.twoFactorChallenge.update({ where: { id: challenge.id }, data: { attemptCount, ...(attemptCount >= MAX_ATTEMPTS ? { status: "failed" } : {}) } });
        await logAction({ actorId: challenge.userId, action: "2fa.otp_verification_failed", entityType: "two_factor_challenge", entityId: challenge.id, changes: { method: challenge.method, purpose, attemptCount } });
        throw new AuthenticationError(attemptCount >= MAX_ATTEMPTS ? "Too many verification attempts. Request a new code." : "The verification code is incorrect. Please try again.", attemptCount >= MAX_ATTEMPTS ? "2FA_TOO_MANY_ATTEMPTS" : "2FA_CODE_INVALID");
    }

    const now = new Date();
    await prisma.$transaction([
        prisma.twoFactorChallenge.update({ where: { id: challenge.id }, data: { status: "verified", verifiedAt: now } }),
        prisma.userSecuritySettings.upsert({ where: { userId: challenge.userId }, update: { lastTwoFactorVerifiedAt: now }, create: { userId: challenge.userId, lastTwoFactorVerifiedAt: now } }),
    ]);
    await logAction({ actorId: challenge.userId, action: "2fa.otp_verification_succeeded", entityType: "two_factor_challenge", entityId: challenge.id, changes: { method: challenge.method, purpose } });
    return { userId: challenge.userId, method: challenge.method };
};

export const enableTwoFactor = async ({ user, method, phoneNumber, ipAddress, userAgent }) => {
    const settings = await getSettings(user.id);
    if (method === "email" && !user.emailVerified) throw new BadRequestError("Verify your email before enabling email two-factor authentication", "2FA_EMAIL_UNVERIFIED");
    if (method === "sms" && !phoneNumber && !getPhone(user, settings)) throw new BadRequestError("A phone number is required for SMS two-factor authentication", "2FA_PHONE_REQUIRED");
    if (method === "sms" && phoneNumber) {
        await prisma.userSecuritySettings.upsert({
            where: { userId: user.id },
            update: { phoneNumber },
            create: { userId: user.id, phoneNumber },
        });
    }
    return createChallenge({ user, method, purpose: "enrollment", phoneNumber, ipAddress, userAgent });
};

export const setEmailTwoFactorEnabled = async (user, enabled) => {
    if (!user.emailVerified) throw new BadRequestError("Verify your email before enabling two-factor authentication", "2FA_EMAIL_UNVERIFIED");
    const now = new Date();
    const settings = await getSettings(user.id);
    const preferredMethod = enabled
        ? resolvePreferredMethod({
            email: true,
            sms: Boolean(settings?.smsTwoFactorEnabled && settings.phoneVerifiedAt && getPhone(user, settings)),
        }, settings)
        : null;
    const updated = await prisma.userSecuritySettings.upsert({
        where: { userId: user.id },
        update: {
            twoFactorEnabled: enabled,
            emailTwoFactorEnabled: enabled,
            ...(enabled ? { preferredMethod, emailVerifiedAt: now, twoFactorEnabledAt: settings?.twoFactorEnabledAt || now } : {}),
        },
        create: {
            userId: user.id,
            twoFactorEnabled: enabled,
            emailTwoFactorEnabled: enabled,
            preferredMethod,
            emailVerifiedAt: enabled ? now : null,
            twoFactorEnabledAt: enabled ? now : null,
        },
    });
    await logAction({ actorId: user.id, action: enabled ? "2fa.enabled" : "2fa.disabled", entityType: "user_security_settings", entityId: updated.id, changes: { method: "email", immediate: true } });
    return getTwoFactorStatus(user);
};

export const setTwoFactorEnabled = async (user, enabled) => {
    if (enabled) return setEmailTwoFactorEnabled(user, true);
    if (user.role === "admin") throw new BadRequestError("Admin two-factor authentication is mandatory", "2FA_ADMIN_MANDATORY");
    throw new BadRequestError(
        "Confirm with your password and a verification code to disable two-factor authentication",
        "2FA_SECURE_DISABLE_REQUIRED"
    );
};

export const setPreferredMethod = async (user, method) => {
    const settings = await getSettings(user.id);
    if (!settings?.twoFactorEnabled) throw new BadRequestError("Two-factor authentication is not enabled", "2FA_NOT_ENABLED");
    const methods = getMethods(user, settings);
    if (!methods[method]) throw new BadRequestError("That verification method is not enabled", "2FA_METHOD_UNAVAILABLE");
    const updated = await prisma.userSecuritySettings.update({
        where: { userId: user.id },
        data: { preferredMethod: method },
    });
    await logAction({
        actorId: user.id,
        action: "2fa.preferred_method_changed",
        entityType: "user_security_settings",
        entityId: updated.id,
        changes: { preferredMethod: method },
    });
    return getTwoFactorStatus(user);
};

export const getAdminTwoFactorSummary = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true, securitySettings: true },
    });
    if (!user) throw new NotFoundError("User not found", "USER_NOT_FOUND");
    const settings = user.securitySettings;
    const methods = getMethods(user, settings);
    return {
        enabled: Boolean(settings?.twoFactorEnabled),
        preferredMethod: resolvePreferredMethod(methods, settings),
        methods: {
            email: methods.email,
            sms: methods.sms,
        },
        lastVerifiedAt: settings?.lastTwoFactorVerifiedAt || null,
        enabledAt: settings?.twoFactorEnabledAt || null,
        mandatory: user.role === "admin",
        recommended: user.role === "therapist",
    };
};

export const adminResetTwoFactor = async ({ admin, targetUserId, reason }) => {
    const trimmedReason = String(reason || "").trim();
    if (trimmedReason.length < 10) {
        throw new BadRequestError("Provide a recovery reason of at least 10 characters", "2FA_RECOVERY_REASON_REQUIRED");
    }
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundError("User not found", "USER_NOT_FOUND");
    if (target.role === "admin") {
        throw new BadRequestError("Admin two-factor authentication requires an approved security workflow", "2FA_ADMIN_MANDATORY");
    }

    const settings = await getSettings(targetUserId);
    if (!settings?.twoFactorEnabled && !settings?.smsTwoFactorEnabled && !settings?.emailTwoFactorEnabled) {
        throw new BadRequestError("Two-factor authentication is not enabled for this account", "2FA_NOT_ENABLED");
    }

    const updated = await prisma.userSecuritySettings.upsert({
        where: { userId: targetUserId },
        update: {
            twoFactorEnabled: false,
            preferredMethod: null,
            emailTwoFactorEnabled: false,
            smsTwoFactorEnabled: false,
            phoneNumber: null,
            phoneVerifiedAt: null,
        },
        create: {
            userId: targetUserId,
            twoFactorEnabled: false,
            preferredMethod: null,
            emailTwoFactorEnabled: false,
            smsTwoFactorEnabled: false,
        },
    });

    await prisma.twoFactorChallenge.updateMany({
        where: { userId: targetUserId, status: "pending" },
        data: { status: "cancelled" },
    });

    await logAction({
        actorId: admin.id,
        action: "2fa.recovery_initiated",
        entityType: "user_security_settings",
        entityId: updated.id,
        changes: { targetUserId, reason: trimmedReason },
    });

    return getAdminTwoFactorSummary(targetUserId);
};

export const completeEnrollment = async ({ user, challengeId, challengeToken, code }) => {
    const result = await verifyChallenge({ challengeId, challengeToken, code, purpose: "enrollment" });
    const challenge = await prisma.twoFactorChallenge.findUnique({ where: { id: challengeId } });
    const now = new Date();
    const settings = await getSettings(user.id);
    const nextMethods = {
        email: result.method === "email" ? true : Boolean(settings?.emailTwoFactorEnabled),
        sms: result.method === "sms" ? true : Boolean(settings?.smsTwoFactorEnabled && settings.phoneVerifiedAt),
    };
    const preferredMethod = resolvePreferredMethod(nextMethods, settings);
    await prisma.userSecuritySettings.upsert({
        where: { userId: user.id },
        update: {
            twoFactorEnabled: true,
            preferredMethod,
            emailTwoFactorEnabled: result.method === "email" ? true : settings?.emailTwoFactorEnabled || false,
            smsTwoFactorEnabled: result.method === "sms" ? true : settings?.smsTwoFactorEnabled || false,
            ...(result.method === "sms" ? { phoneNumber: settings?.phoneNumber || user.customerProfile?.phone || user.therapistProfile?.phone, phoneVerifiedAt: now } : { emailVerifiedAt: now }),
            twoFactorEnabledAt: settings?.twoFactorEnabledAt || now,
        },
        create: {
            userId: user.id,
            twoFactorEnabled: true,
            preferredMethod,
            emailTwoFactorEnabled: result.method === "email",
            smsTwoFactorEnabled: result.method === "sms",
            ...(result.method === "sms" ? { phoneNumber: settings?.phoneNumber, phoneVerifiedAt: now } : { emailVerifiedAt: now }),
            twoFactorEnabledAt: now,
        },
    });
    await logAction({ actorId: user.id, action: "2fa.enabled", entityType: "two_factor_challenge", entityId: challenge.id, changes: { method: result.method } });
    return getTwoFactorStatus(user);
};

export const startDisableChallenge = async ({ user, method, ipAddress, userAgent }) => {
    const settings = await getSettings(user.id);
    if (!settings?.twoFactorEnabled) throw new BadRequestError("Two-factor authentication is not enabled", "2FA_NOT_ENABLED");
    const methods = getMethods(user, settings);
    return createChallenge({ user, method: resolvePreferredMethod(methods, settings, method), purpose: "disable", ipAddress, userAgent });
};

export const disableTwoFactor = async ({ user, challengeId, challengeToken, code }) => {
    if (user.role === "admin") throw new BadRequestError("Admin two-factor authentication requires an approved security workflow", "2FA_ADMIN_MANDATORY");
    const verification = await verifyChallenge({ challengeId, challengeToken, code, purpose: "disable" });
    if (verification.userId !== user.id) throw new AuthenticationError("This verification challenge is no longer valid", "2FA_CHALLENGE_INVALID");
    await prisma.userSecuritySettings.update({ where: { userId: user.id }, data: { twoFactorEnabled: false } });
    await logAction({ actorId: user.id, action: "2fa.disabled", entityType: "two_factor_challenge", entityId: challengeId, changes: null });
    return getTwoFactorStatus(user);
};

export const removeSmsMethod = async (user) => {
    const settings = await getSettings(user.id);
    if (!settings?.smsTwoFactorEnabled) throw new BadRequestError("SMS two-factor authentication is not enabled", "2FA_SMS_NOT_ENABLED");
    if (!settings.emailTwoFactorEnabled) throw new BadRequestError("Email two-factor authentication must remain enabled", "2FA_EMAIL_REQUIRED");
    const updated = await prisma.userSecuritySettings.update({
        where: { userId: user.id },
        data: { smsTwoFactorEnabled: false, phoneNumber: null, phoneVerifiedAt: null, preferredMethod: "email" },
    });
    await logAction({ actorId: user.id, action: "2fa.sms_removed", entityType: "user_security_settings", entityId: updated.id, changes: { method: "sms" } });
    return getTwoFactorStatus(user);
};

export const constants = { OTP_TTL_MS, RESEND_COOLDOWN_MS, MAX_SENDS_PER_WINDOW, MAX_ATTEMPTS };
export { getMethods, resolvePreferredMethod };
