import { USER_ROLES } from "../utils/constants.js";
import { APPROVAL_STATUS } from "../utils/constants.js";
import { supabase } from "../config/supabase.js";
import { prisma } from "../config/prisma.js";
import { AuthenticationError, AuthorizationError } from "../utils/errors.js";

/**
 * Extract token from request
 * Checks both Authorization header and cookies
 */
const extraToken = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }

    if (req.cookies && req.cookies.sb_access_token) {
        return req.cookies.sb_access_token;
    }

    return null;
};

/**
 * Authenticate user with Supabase JWT
 * Verifies the JWT and loads user data from database
 */
export const authenticate = async (req, res, next) => {
    try {
        const token = extraToken(req);

        if (!token) {
            throw new AuthenticationError("Authentication required. Please log in.", "NO_TOKEN");
        }

        // Verify token with supabase
        const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);

        if (error || !supabaseUser) {
            console.error("Token verification error:", error);
            throw new AuthenticationError("Invalid or expired token", "INVALID_TOKEN");
        }

        const user = await prisma.user.findUnique({
            where: { id: supabaseUser.id },
            include: {
                customerProfile: true,
                therapistProfile: true
            },
        });

        if (!user) {
            throw new AuthenticationError("User account not found", "USER_NOT_FOUND");
        }

        if (!user.isActive) {
            throw new AuthenticationError("Your account has been deactivated", "ACCOUNT_DEACTIVATED");
        }

        // Attach user and Supabase user to request
        req.user = user;
        req.supabaseUser = supabaseUser;
        req.accessToken = token;

        next();
    } catch (error) {
        // Only clear the access token — preserve the refresh token so the
        // frontend interceptor can still call /auth/token/refresh and get
        // a new access token. Clearing both causes premature logouts.
        if (error instanceof AuthenticationError && error.code !== "ACCOUNT_DEACTIVATED") {
            const isSecureContext = process.env.COOKIE_SECURE === "true";
            const clearOptions = {
                path: "/",
                httpOnly: true,
                secure: isSecureContext,
                sameSite: isSecureContext ? "none" : "lax",
            };
            res.clearCookie("sb_access_token", clearOptions);
        }
        next(error);
    }
};

/**
 * Optional authentication middleware
 * Attaches user to request if token is present, but doesn't require it
 */
export const optionalAuthenticate = async (req, res, next) => {
    try {
        const token = extraToken(req);

        if (!token) {
            return next();
        }

        const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);

        if (error || !supabaseUser) {
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: supabaseUser.id },
            include: {
                customerProfile: true,
                therapistProfile: true,
            },
        });

        if (user && user.isActive) {
            req.user = user;
            req.supabaseUser = supabaseUser;
            req.accessToken = token;
        }

        next();
    } catch (error) {
        next();
    }
}

/**
 * Authorize specific roles
 * Must be used after authenticate middleware
 */
export const authorize = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(new AuthenticationError("Authentication required"));
        }

        if (!roles.includes(req.user.role)) {
            return next(
                new AuthorizationError(
                    `Access denied. Required role(s): ${roles.join(", ")}`,
                    `INSUFFICIENT_PERMISSIONS`
                )
            );
        }

        next();
    };
};

/**
 * Require email verification
 * Must be used after authenticate middleware
 */
export const requireEmailVerification = (req, res, next) => {
    if (!req.user) {
        return next(new AuthenticationError("Authentication required"));
    }

    if (!req.user.emailVerified && !req.supabaseUser?.email_confirmed_at) {
        return next(
            new AuthenticationError(
                "Please verify your email address to access this resource",
                "EMAIL_NOT_VERIFIED"
            )
        );
    }
    next();
}

/**
 * Require therapist approval
 * Must be used after authenticate middleware
 */
export const requireTherapistApproval = (req, res, next) => {
    if (!req.user) {
        return next(new AuthenticationError("Authentication required"));
    }

    if (req.user.role !== USER_ROLES.THERAPIST) {
        return next(new AuthorizationError("This resource is only available to therapists"));
    }

    if (!req.user.therapistProfile) {
        return next(new AuthenticationError("Therapist profile not found", "PROFILE_NOT_FOUND"));
    }

    if (req.user.therapistProfile.approvalStatus !== APPROVAL_STATUS.APPROVED) {
        const statusMessages = {
            pending: "Your therapist account is pending approval",
            rejected: "Your therapist account has been rejected. Please contact support."
        }

        return next(
            new AuthenticationError(
                statusMessages[req.user.therapistProfile.approvalStatus] ||
                "Your therapist account is not approved",
                "NOT_APPROVED"
            )
        );
    }

    next();
}