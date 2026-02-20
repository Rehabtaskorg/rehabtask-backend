import { supabase, supabaseAdmin } from "../config/supabase.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { AuthenticationError, ConflictError, ValidationError, BadRequestError, NotFoundError } from "../utils/errors.js";

/**
 * Register a new customer
 * Creates Supabase auth user (with email confirmation)
 */
export const registerCustomer = async ({ email, password, fullName, phone, customerType, agencyName }) => {
    const normalizedEmail = email.toLowerCase().trim();
    let authUser;

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
                return {
                    message: "Registration successful. Please check your email for verification.",
                    user: null
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
            return db.user.create({
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
                }
            });
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
        console.log("Error object:", error);

        /**
         * Handle Prisma uniqueness safely
         * Treat duplicate DB records as idempotent success
         */
        if (error?.code === "P2002" && error?.meta?.modelName === "User") {
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
                return {
                    message: "Registration successful. Please check your email and wait for admin approval.",
                    user: null
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
            therapistProfile: true
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
            customerProfile: {
                select: {
                    fullName: true,
                },
            },
            therapistProfile: {
                select: {
                    fullName: true,
                    approvalStatus: true,
                    profilePhotoUrl: true,
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
                : user.therapistProfile
    };
};

/**
 * Mark a user as emai verified in your database
 * Called by the frontend after Supabase session exists
 */
export const markEmailVerified = async ({ userId }) => {
    if (!userId) throw new BadRequestError("User ID is required");

    try {
        await withAdminAccess(async (db) => {
            await db.user.update({
                where: { id: userId },
                data: { emailVerified: true }
            });
        });

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
        console.error("Resend verification error:", error);
        // Don't reveal if email exists
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
                            phone: profileData.phone || "",
                            customerType: profileData.customerType || "individual",
                            agencyName: profileData.customerType === "agency" ? profileData.agencyName : null,
                            location: profileData.location || null,
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
                            phone: profileData.phone || "",
                            specialization: profileData.specialization || null,
                            licenseNumber: profileData.licenseNumber,
                            workArea: profileData.workArea || null,
                            approvalStatus: "pending", // Requires admin approval
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

    return {
        session: data.session,
        user: data.user,
    };
};