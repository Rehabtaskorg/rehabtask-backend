import { supabase, supabaseAdmin } from "../config/supabase.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { AuthenticationError, ConflictError, ValidationError, BadRequestError, NotFoundError } from "../utils/errors.js";

/**
 * Register a new customer
 * Creates both Supabase auth user and application user record
 */
export const registerCustomer = async ({ email, password, fullName, phone, location, customerType, agencyName }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (existingUser) {
        return {
            message: "Registration successful. Please check your email for verification.",
            isNew: false
        };
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: false, // require email verification
        user_metadata: {
            full_name: fullName,
            role: "customer",
            customer_type: customerType
        },
    });

    if (authError) {
        console.error("Supabase auth error:", authError);

        if (authError.message.includes("already registered")) {
            return {
                message: "Registration successful. Please check your email for verification.",
                isNew: false
            }
        }

        throw new BadRequestError("Failed to process registration");
    }

    try {
        // Create user record in our DB using admin access
        const user = await withAdminAccess(async (db) => {
            return db.user.create({
                data: {
                    id: authData.user.id,
                    email: normalizedEmail,
                    passwordHash: "", // Supabase manages passwords
                    role: "customer",
                    emailVerified: false,
                    isActive: true,
                    customerProfile: {
                        create: {
                            fullName,
                            phone,
                            location,
                            ...(customerType === "agency" && agencyName && {
                                // Store agency name in a JSON field or add to schema
                                // for now, we'll use fullName for agency
                                fullName: agencyName,
                            }),
                        },
                    },
                },
                include: {
                    customerProfile: true,
                },
            });
        });

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                customerProfile: user.customerProfile,
            },
            message: "Registration successful. Please check your email to verify your account.",
        };
    } catch (error) {
        // Rollback: Delete the Supabase user if database creation fails
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        throw error;
    }

};

/**
 * Register a new therapist
 * Creates both Supabase auth user and application user record
 */
export const registerTherapist = async ({ email, password, fullName, phone, specialization, licenseNumber }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (existingUser) {
        return {
            message: "Registration successful. Please check your email for verification.",
            isNew: false
        };
    }

    const existingLicense = await prisma.therapistProfile.findUnique({
        where: { licenseNumber },
    });

    if (existingLicense) {
        throw new ConflictError("This license number is already registered");
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: false,
        user_metadata: {
            full_name: fullName,
            role: "therapist",
            specialization,
        },
    });

    if (authError) {
        console.error("Supabase auth error:", authError);

        if (authError.message.includes("already registered")) {
            return {
                message: "Registration successful. Please check your email for verification.",
                isNew: false
            }
        }

        throw new BadRequestError("Failed to process registration");
    }

    try {
        // Create user record in DB
        const user = await withAdminAccess(async (db) => {
            return db.user.create({
                data: {
                    id: authData.user.id,
                    email: normalizedEmail,
                    passwordHash: "",
                    role: "therapist",
                    emailVerified: false,
                    isActive: true,
                    therapistProfile: {
                        create: {
                            fullName,
                            phone,
                            specialization,
                            licenseNumber,
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
                therapistProfile: user.therapistProfile,
            },
            message: 'Registration successfuly. Please verify your email and wait for admin approval.'
        }

    } catch (error) {
        // rollback: Delete the Supabase user
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        throw error;
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
        throw new AuthenticationError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    const user = await prisma.user.findUnique({
        where: { id: data.user.id },
        include: {
            customerProfile: true,
            therapistProfile: true
        }
    });

    if (!user || !user.isActive) {
        await supabase.auth.signOut();
        throw new NotFoundError("User account not found", "USER_NOT_FOUND");
    }

    // Check if email is verified
    if (!user.emailVerified && !data.user.email_confirmed_at) {
        throw new AuthenticationError("Please verify your email before logging in.", "EMAIL_NOT_VERIFIED");
    }

    // Role specific logic (Therapists)
    if (user.role === "therapist" && user.therapistProfile.approvalStatus !== "approved") {
        await supabase.auth.signOut();
        const status = user.therapistProfile?.approvalStatus;
        throw new AuthenticationError(
            status === "pending" ? "Account pending approval." : "Account rejected",
            status === "pending" ? "ACCOUNT_PENDING" : "ACCOUNT_REJECTED"
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
            customerProfile: user.customerProfile,
            therapistProfile: user.therapistProfile,
        },
        session: data.session,
        supabaseUser: data.user
    };
};

/**
 * Logout user
 */
export const logout = async (accessToken) => {
    if (!accessToken) {
        return { success: true };
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error("Logout error:", error);
    }

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
            createdAt: true,
            customerProfile: {
                select: {
                    fullName: true,
                    phone: true,
                    location: true,
                    customerType: true
                },
            },
            therapistProfile: {
                select: {
                    fullName: true,
                    phone: true,
                    specialization: true,
                    licenseNumber: true,
                    approvalStatus: true,
                    rejectionReason: true,
                    workArea: true
                }
            }
        }
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    return user;
};

/**
 * Request password reset
 */
export const requestPasswordReset = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    // Use supabase's password reset flow
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`
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
 * Reset password with token
 */
export const resetPassword = async ({ password, accessToken }) => {
    if (!accessToken) {
        throw new BadRequestError("Invalid or expired reset token");
    }

    // Verify and update password using Supabase
    const { data, error } = await supabase.auth.updateUser({ password });

    if (error) {
        console.error("Password reset error:", error);
        throw new BadRequestError("Failed to reset password. Token may be invalid or expired.");
    }

    return {
        message: "Password has been reset successfully. You can now log in with your new password.",
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
 * Verify email with token
 */
export const verifyEmail = async ({ token, type = "signup" }) => {
    // Supabase handles email verification through magic links
    // This endpoint is called after user clicks the verification link
    const { data, error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: type
    });

    if (error) {
        console.error("Email verification error:", error);
        throw new BadRequestError("Invalid or expired verification token");
    }

    // Update our database
    if (data.user) {
        await withAdminAccess(async (db) => {
            await db.user.update({
                where: { id: data.user.id },
                data: { emailVerified: true },
            });
        });
    }

    return {
        message: "Email verified successfully. You can now log in.",
        user: data.user,
    };
};

/**
 * Resend verification email
 */
export const resendVerificationEmail = async ({ email }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail
    });

    if (error) {
        console.error("Resend verification error:", error);
        // Don't reveal if email exists
    }

    return {
        message: "If an unverified account exists with this email, a verification link has been sent."
    };
};

/**
 * Handle OAuth callback (Google, Facebook)
 */
export const handleOAuthCallback = async ({ code, provider }) => {
    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
        console.error("OAuth callback error:", error);
        throw new AuthenticationError("OAuth authentication failed");
    }

    const supabaseUser = data.user;

    let user = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
        include: {
            customerProfile: true,
            therapistProfile: true,
        },
    });

    // if user doesn't exist, create them (first time OAuth login)
    if (!user) {
        user = await withAdminAccess(async (db) => {
            return db.user.create({
                data: {
                    id: supabaseUser.id,
                    email: supabaseUser.email,
                    passwordHash: "",
                    role: "customer", // Default role for OAuth users
                    emailVerified: true,
                    isActive: true
                },
            });
        });

        // return user with needsOnboarding flag
        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified,
                needsOnboarding: true,
            },
            session: data.session,
            supabaseUser,
        };
    }

    // Check if profile is complete
    const needsOnboarding = user.role === "customer"
        ? !user.customerProfile
        : !user.therapistProfile;

    return {
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            emailVerified: user.emailVerified,
            isActive: user.isActive,
            customerProfile: user.customerProfile,
            therapistProfile: user.therapistProfile,
            needsOnboarding,
        },
        session: data.session,
        supabaseUser,
    };
};

/**
 * Complete OAuth onboarding
 */
export const completeOAuthOnboarding = async ({ userId, role, profileData }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

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
                            phone: profileData.phone,
                            location: profileData.location,
                        },
                    },
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
                            phone: profileData.phone,
                            specialization: profileData.specialization,
                            licenseNumber: profileData.licenseNumber,
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

    return {
        user: {
            id: updatedUser.id,
            email: updatedUser.email,
            role: updatedUser.role,
            emailVerified: updatedUser.emailVerified,
            customerProfile: updatedUser.customerProfile,
            therapistProfile: updatedUser.therapistProfile,
        },
        message: "Profile completed successfully",
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

    return {
        session: data.session,
        user: data.user,
    };
};