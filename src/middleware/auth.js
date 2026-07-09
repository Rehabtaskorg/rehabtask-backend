import { USER_ROLES, APPROVAL_STATUS } from "../utils/constants.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { prisma } from "../config/prisma.js";
import { AuthenticationError, AuthorizationError } from "../utils/errors.js";

/**
 * Extract bearer token from Authorization header or httpOnly cookie.
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 */
const extractToken = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }

    if (req.cookies?.sb_access_token) {
        return req.cookies.sb_access_token;
    }

    return null;
};

/**
 * Verify an Identity Platform ID token and return the decoded claims.
 *
 * @param {string} token
 * @returns {Promise<import("firebase-admin/auth").DecodedIdToken>}
 */
const verifyToken = async (token) => {
    const auth = getIdentityPlatformAuth();
    return auth.verifyIdToken(token);
};

/**
 * Authenticate request using Identity Platform JWT.
 * Verifies the token, loads the user record, and attaches it to req.user.
 *
 * @type {import("express").RequestHandler}
 */
export const authenticate = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            throw new AuthenticationError("Authentication required. Please log in.", "NO_TOKEN");
        }

        let decodedToken;
        try {
            decodedToken = await verifyToken(token);
        } catch {
            throw new AuthenticationError("Invalid or expired token", "INVALID_TOKEN");
        }

        const user = await prisma.user.findUnique({
            where: { id: decodedToken.uid },
            include: {
                customerProfile: true,
                therapistProfile: true,
            },
        });

        if (!user) {
            throw new AuthenticationError("User account not found", "USER_NOT_FOUND");
        }

        if (!user.isActive) {
            throw new AuthenticationError("Your account has been deactivated", "ACCOUNT_DEACTIVATED");
        }

        req.user = user;
        req.decodedToken = decodedToken;
        req.accessToken = token;

        next();
    } catch (error) {
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
 * Optional authentication — attaches user if a valid token is present,
 * but does not reject the request if one is absent or invalid.
 *
 * @type {import("express").RequestHandler}
 */
export const optionalAuthenticate = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) return next();

        let decodedToken;
        try {
            decodedToken = await verifyToken(token);
        } catch {
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: decodedToken.uid },
            include: {
                customerProfile: true,
                therapistProfile: true,
            },
        });

        if (user?.isActive) {
            req.user = user;
            req.decodedToken = decodedToken;
            req.accessToken = token;
        }

        next();
    } catch {
        next();
    }
};

/**
 * Authorise by role. Must be used after authenticate.
 *
 * @param {string[]} roles
 * @returns {import("express").RequestHandler}
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
                    "INSUFFICIENT_PERMISSIONS"
                )
            );
        }

        next();
    };
};

/**
 * Require email verification. Must be used after authenticate.
 *
 * @type {import("express").RequestHandler}
 */
export const requireEmailVerification = (req, res, next) => {
    if (!req.user) {
        return next(new AuthenticationError("Authentication required"));
    }

    if (!req.user.emailVerified && !req.decodedToken?.email_verified) {
        return next(
            new AuthenticationError(
                "Please verify your email address to access this resource",
                "EMAIL_NOT_VERIFIED"
            )
        );
    }

    next();
};

/**
 * Require therapist approval. Must be used after authenticate.
 *
 * @type {import("express").RequestHandler}
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
            rejected: "Your therapist account has been rejected. Please contact support.",
        };

        return next(
            new AuthenticationError(
                statusMessages[req.user.therapistProfile.approvalStatus] ||
                "Your therapist account is not approved",
                "NOT_APPROVED"
            )
        );
    }

    next();
};