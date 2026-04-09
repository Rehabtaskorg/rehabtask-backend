import { supabase, supabaseAdmin } from "../config/supabase.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { AuthenticationError, ConflictError, ValidationError, BadRequestError, NotFoundError } from "../utils/errors.js";
import { sendTherapistWelcome, sendSubAdminWelcome, sendExistingAccountNotification } from "./email.service.js";
import { logger } from "../config/logger.js";
import { createTrialSubscription } from "./subscription.service.js";

/**
 * Register a new customer
 * Creates Supabase auth user (with email confirmation)
 */
export const registerCustomer = async ({ email, password, fullName, phone, customerType, agencyName }) => {
    const normalizedEmail = email.toLowerCase().trim();
    let authUser;

    // Pre-check: does this email already exist in our DB?
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        // Send custom notification instead of Supabase's generic reset email
        try {
            const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
                type: "recovery",
                email: normalizedEmail,
                options: { redirectTo: `${process.env.FRONTEND_URL}/reset-password` },
            });
            const resetLink = linkData?.properties?.action_link || `${process.env.FRONTEND_URL}/forgot-password`;

            sendExistingAccountNotification({ email: normalizedEmail, resetLink }).catch((err) => {
                logger.error("[Auth] Failed to send existing account notification", { email: normalizedEmail, error: err.message });
            });
        } catch (linkErr) {
            logger.error("[Auth] Failed to generate recovery link", { email: normalizedEmail, error: linkErr.message });
        }

        return {
            message: "Registration successful. Please check your email for verification.",
            user: null,
        };
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            phone: phone,
            options: {
                data: {
                    full_name: fullName,
                    role: "customer",
                    customer_type: customerType,
                },
                emailRedirectTo: `${process.env.FRONTEND_URL}/verify-callback`
            }
        })

        if (error) {
            if (error.status === 422 || error.message?.toLowerCase().includes("already registered")) {
                // Generate a password reset link without sending Supabase's generic email
                try {
                    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
                        type: "recovery",
                        email: normalizedEmail,
                        options: { redirectTo: `${process.env.FRONTEND_URL}/reset-password` },
                    });
                    const resetLink = linkData?.properties?.action_link || `${process.env.FRONTEND_URL}/forgot-password`;

                    sendExistingAccountNotification({ email: normalizedEmail, resetLink }).catch((err) => {
                        logger.error("[Auth] Failed to send existing account notification", { email: normalizedEmail, error: err.message });
                    });
                } catch (linkErr) {
                    logger.error("[Auth] Failed to generate recovery link", { email: normalizedEmail, error: linkErr.message });
                }

                // Return identical response to prevent email enumeration
                return {
                    message: "Registration successful. Please check your email for verification.",
                    user: null,
                };
            }

            throw error;
        }

        authUser = data?.user;

        if (!authUser?.id) {
            throw new Error("Supabase user creation failed");
        }

        // CHECK: is this email already registered as a patient under an agency?
        const existingPatient = await prisma.patient.findFirst({
            where: {
                email: normalizedEmail,
                userId: null // only link if not already linked
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

        // Create user record in our DB using admin access
        const user = await withAdminAccess(async (db) => {
            const createdUser = await db.user.create({
                data: {
                    id: authUser.id,
                    email: normalizedEmail,
                    passwordHash: "", // Supabase manages passwords
                    role: "customer",
                    emailVerified: false,
                    isActive: true,
                    customerProfile: {
                        create: {
                            fullName,
                            phone,
                            customerType,
                            agencyName: customerType === "agency" ? agencyName : null,
                        },
                    },
                    ...(existingPatient && {
                        patientProfile: {
                            connect: { id: existingPatient.id }
                        }
                    })
                },
                include: { customerProfile: true },
            });

            // Create 30-day trial subscription with Standard limits
            logger.info("[DEBUG register] About to create trial subscription", {
                userId: createdUser.id,
                customerProfileId: createdUser.customerProfile?.id,
                email: normalizedEmail,
            });
            await createTrialSubscription(createdUser.customerProfile.id, db);
            logger.info("[DEBUG register] Trial subscription created inside transaction", {
                customerProfileId: createdUser.customerProfile?.id,
            });

            return createdUser;
        });

        let message = "Registration successful. Please check your email to verify your account."

        if (existingPatient) {
            message += ` Your account has been linked to ${existingPatient.agency.agencyName || "an agency"
                }.`;
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                needsEmailVerification: true,
                hasLinkedRecords: Boolean(existingPatient)
            },
            message
        };
    } catch (error) {
        /**
         * Handle Prisma uniqueness safely
         * Treat duplicate DB records as idempotent success
         */
        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await supabase.auth.resetPasswordForEmail(normalizedEmail, {
                redirectTo: `${process.env.FRONTEND_URL}/reset-password`
            });
            return {
                message: "Registration successful. Please check your email for verification.",
                user: null
            }
        }

        /**
         * Rollback supabase user ONLY if we created it
         */
        if (authUser?.id) {
            try {
                await supabaseAdmin.auth.admin.deleteUser(authUser.id);
            } catch (error) {
                // Intentionally ignored - avoid cascading failures
            }
        }


        throw new BadRequestError("Failed to process registration. Please try again.");
    }

};

/**
 * Register a new therapist
 * Creates both Supabase auth user and application user record
 */
export const registerTherapist = async ({ email, password, fullName, phone }) => {
    const normalizedEmail = email.toLowerCase().trim();
    let authUser;

    // Pre-check: does this email already exist in our DB?
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        try {
            const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
                type: "recovery",
                email: normalizedEmail,
                options: { redirectTo: `${process.env.FRONTEND_URL}/reset-password` },
            });
            const resetLink = linkData?.properties?.action_link || `${process.env.FRONTEND_URL}/forgot-password`;

            sendExistingAccountNotification({ email: normalizedEmail, resetLink }).catch((err) => {
                logger.error("[Auth] Failed to send existing account notification", { email: normalizedEmail, error: err.message });
            });
        } catch (linkErr) {
            logger.error("[Auth] Failed to generate recovery link", { email: normalizedEmail, error: linkErr.message });
        }

        return {
            message: "Registration successful. Please check your email and wait for admin approval.",
            user: null,
        };
    }

    try {

        const { data, error } = await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            phone: phone,
            options: {
                data: {
                    full_name: fullName,
                    role: "therapist",
                },
                emailRedirectTo: `${process.env.FRONTEND_URL}/verify-callback`
            }
        });

        if (error) {
            if (error.status === 422 || error.message.includes("already registered")) {
                try {
                    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
                        type: "recovery",
                        email: normalizedEmail,
                        options: { redirectTo: `${process.env.FRONTEND_URL}/reset-password` },
                    });
                    const resetLink = linkData?.properties?.action_link || `${process.env.FRONTEND_URL}/forgot-password`;

                    sendExistingAccountNotification({ email: normalizedEmail, resetLink }).catch((err) => {
                        logger.error("[Auth] Failed to send existing account notification", { email: normalizedEmail, error: err.message });
                    });
                } catch (linkErr) {
                    logger.error("[Auth] Failed to generate recovery link", { email: normalizedEmail, error: linkErr.message });
                }

                return {
                    message: "Registration successful. Please check your email and wait for admin approval.",
                    user: null,
                };
            }
            throw error;
        }

        authUser = data.user;

        // Create user record in DB
        const user = await withAdminAccess(async (db) => {
            return db.user.create({
                data: {
                    id: authUser.id,
                    email: normalizedEmail,
                    passwordHash: "",
                    role: "therapist",
                    emailVerified: false,
                    isActive: true,
                    therapistProfile: {
                        create: {
                            fullName,
                            phone,
                            approvalStatus: "pending", // requires admin approval
                        },
                    },
                },
                include: {
                    therapistProfile: true,
                },
            });
        });

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                needsEmailVerification: true
            },
            message: 'Registration successfuly. Please verify your email and wait for admin approval.',
            isNew: true,
        };

    } catch (error) {
        /**
         * Handle Prisma uniqueness safely
         * Treat duplicate DB records as idempotent success
         */
        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
            await supabase.auth.resetPasswordForEmail(normalizedEmail, {
                redirectTo: `${process.env.FRONTEND_URL}/reset-password`
            });
            return {
                message: "Registration successful. Please check your email and wait for admin approval.",
                user: null
            }
        }

        if (authUser?.id) {
            await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        }

        console.error("Registration failed:", error);
        throw new BadRequestError("Failed to process registration. Please try again.");
    }

};

/**
 * Login with email and password
 */
export const login = async ({ email, password }) => {
    const normalizedEmail = email.toLowerCase().trim();

    // Attempt to sign in with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
    });

    if (error) {
        console.error("Login error:", error);

        // Check if it's specifically an email not confirmed error using the error code
        if (error.code === "email_not_confirmed") {
            throw new AuthenticationError(
                "Please verify your email address before logging in. Check your inbox for the verification link.",
                "EMAIL_NOT_VERIFIED"
            );
        }

        // Generic error for invalid credentials (prevents email enumeration)
        throw new AuthenticationError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    const user = await prisma.user.findUnique({
        where: { id: data.user.id },
        include: {
            customerProfile: true,
            therapistProfile: true,
            subAdminProfile: true,
        }
    });

    if (!user || !user.isActive) {
        await supabase.auth.signOut();
        throw new NotFoundError("User account not found", "USER_NOT_FOUND");
    }

    // Double check email verification from Supabase
    if (!data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        throw new AuthenticationError(
            "Please verify your email address before logging in. Check your inbox for the verification link.",
            "EMAIL_NOT_VERIFIED"
        );
    }

    // Update emailVerified status if it changed in Supabase
    if (data.user.email_confirmed_at && !user.emailVerified) {
        await withAdminAccess(async (db) => {
            await db.user.update({
                where: { id: user.id },
                data: { emailVerified: true }
            });
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
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at
        },
    };
};

/**
 * Logout user — only clears cookies on the requesting client.
 * We intentionally do NOT call supabase.auth.signOut() because:
 * 1. The backend Supabase client is shared (not per-user), so signOut() revokes ALL sessions
 * 2. This causes other devices/browsers for the same user to get logged out
 * 3. The access token will expire naturally (1 hour) via Supabase's JWT expiry
 * 4. Cookie clearing on the controller side is sufficient for the requesting client
 * TODO: For production, create separate accounts per user for proper audit trail.
 */
export const logout = async (accessToken) => {
    // No Supabase signOut — just return success. Cookies are cleared by the controller.
    return { success: true };
};

/**
 * Get current user by ID
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
                    agencyName: true
                },
            },
            therapistProfile: {
                select: {
                    fullName: true,
                    approvalStatus: true,
                    profilePhotoUrl: true,
                    onboardingStep: true,
                    onboardingComplete: true,
                    ratePerVisit: true,
                    primaryLicenseType: true,
                }
            },
            subAdminProfile: {
                select: {
                    permissions: true,
                    isActive: true,
                }
            }
        }
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    return {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        isActive: user.isActive,
        profile:
            user.role === "customer"
                ? user.customerProfile
                : user.role === "therapist"
                    ? user.therapistProfile
                    : user.role === "sub_admin"
                        ? user.subAdminProfile
                        : null
    };
};

/**
 * Mark a user as email verified in your database
 * Called by the frontend after Supabase session exists
 * Sends welcome email to therapists on first verification
 */
export const markEmailVerified = async ({ userId, fullName }) => {
    if (!userId) throw new BadRequestError("User ID is required");

    try {
        // Fetch user before update to check previous verification state
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                emailVerified: true,
                therapistProfile: {
                    select: { id: true, fullName: true }
                }
            }
        });

        if (!user) throw new NotFoundError("User not found");

        const wasAlreadyVerified = user.emailVerified;

        await withAdminAccess(async (db) => {
            await db.user.update({
                where: { id: userId },
                data: { emailVerified: true }
            });

            // Persist the sub-admin's chosen display name on invite acceptance
            if (user.role === "sub_admin" && fullName?.trim()) {
                await db.subAdminProfile.update({
                    where: { userId },
                    data: { fullName: fullName.trim() },
                });
            }
        });

        // Send welcome email to therapists on first verification only
        if (!wasAlreadyVerified && user.role === "therapist" && user.therapistProfile) {
            sendTherapistWelcome({
                therapist: { ...user.therapistProfile, user: { email: user.email } },
            }).catch(() => { });
        }

        // Send welcome email to sub-admins on first verification only
        if (!wasAlreadyVerified && user.role === "sub_admin") {
            sendSubAdminWelcome({ user }).catch(() => { });
        }

        return { message: "Email verified in database" };
    } catch (error) {
        console.error("Error updating emailVerified in DB:", error);
        throw new BadRequestError("Failed to update user email verification");
    }
}

/**
 * Request password reset
 */
export const requestPasswordReset = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    // Use supabase's password reset flow
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });

    if (error) {
        console.error("Password reset request error:", error);
        // Don't receive if email exists
    }

    return {
        message: "If an account exists with this email, you will receive password reset instructions.",
    };
};

/**
 * Change password for authenticated user
 */
export const changePassword = async ({ userId, currentPassword, newPassword }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    // Verify current password by attempting to sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
    });

    if (signInError) {
        throw new AuthenticationError("Current password is incorrect", "INVALID_PASSWORD");
    }

    // Update new password
    const { error: updatedError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword,
    });

    if (updatedError) {
        console.error("Change password error:", updatedError);
        throw new BadRequestError("Failed to change password");
    }

    return {
        message: "Password changed successfully",
    };
};

/**
 * Resend verification email
 */
export const resendVerificationEmail = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
            emailRedirectTo: `${process.env.FRONTEND_URL}/verify-callback`
        }
    });

    if (error) {
        // Rate limit errors should be surfaced — user needs to know to wait
        if (error.status === 429 || error.code === "over_email_send_rate_limit") {
            const waitMatch = error.message?.match(/after (\d+) seconds/);
            const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 60;
            throw new BadRequestError(`Please wait ${waitSeconds} seconds before requesting another verification email.`);
        }
        // Other errors: don't reveal if email exists (prevents enumeration)
        logger.warn("[Auth] Resend verification error", { email: normalizedEmail, error: error.message });
    }

    return {
        message: "If an unverified account exists with this email, a verification link has been sent."
    };
};

/**
 * Complete OAuth onboarding
 */
export const completeOAuthOnboarding = async ({ userId, role, profileData }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            customerProfile: true,
            therapistProfile: true
        }
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    // Prevent re-onboarding if profile already exists
    if (role === "customer" && user.customerProfile) {
        throw new ConflictError("Customer profile already exists");
    }

    if (role === "therapist" && user.therapistProfile) {
        throw new ConflictError("Therapist profile already exists");
    }

    // Check if email was registered as a patient
    const existingPatient = await prisma.patient.findFirst({
        where: {
            email: user.email,
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

    // Update user role if needed
    const updatedUser = await withAdminAccess(async (db) => {
        if (role === "customer") {
            return db.user.update({
                where: { id: userId },
                data: {
                    role: "customer",
                    customerProfile: {
                        create: {
                            fullName: profileData.fullName,
                            phone: profileData.phone || null,
                            customerType: profileData.customerType || "individual",
                            agencyName: profileData.customerType === "agency" ? profileData.agencyName : null,
                        },
                    },
                    ...(existingPatient && {
                        patientProfile: {
                            connect: { id: existingPatient.id }
                        }
                    })
                },
                include: {
                    customerProfile: true,
                },
            });
        } else if (role === "therapist") {
            return db.user.update({
                where: { id: userId },
                data: {
                    role: "therapist",
                    therapistProfile: {
                        create: {
                            fullName: profileData.fullName,
                            phone: profileData.phone || null,
                            approvalStatus: "pending",
                        },
                    },
                },
                include: {
                    therapistProfile: true,
                },
            });
        }
    });

    let message = "Profile completed successfully";

    if (role === "customer" && existingPatient) {
        message += `. Your account has been linked to ${existingPatient.agency.agencyName || "an agency"}.`;
    }

    if (role === "therapist") {
        message += ". Your account is pending admin approval.";
        sendTherapistWelcome({
            therapist: { ...updatedUser.therapistProfile, user: { email: updatedUser.email } },
        }).catch(() => { });
    }

    return {
        user: {
            id: updatedUser.id,
            email: updatedUser.email,
            role: updatedUser.role,
            emailVerified: updatedUser.emailVerified,
            onboardingComplete: true,
            hasLinkedRecords: Boolean(existingPatient)
        },
        message,
    };
};

/**
 * Refresh access token
 */
export const refreshAccessToken = async ({ refreshToken }) => {
    const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
    });

    if (error) {
        console.error("Token refresh error:", error);
        throw new AuthenticationError("Failed to refresh token", "TOKEN_REFRESH_FAILED");
    }

    // Check if user is still active and get role for cookie refresh
    const user = await prisma.user.findUnique({
        where: { id: data.user.id },
        select: { isActive: true, role: true },
    });
    if (!user || !user.isActive) {
        throw new AuthenticationError("Your account has been deactivated", "ACCOUNT_DEACTIVATED");
    }

    return {
        session: data.session,
        user: data.user,
        role: user.role,
    };
};