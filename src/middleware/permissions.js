import { prisma } from "../config/prisma.js";
import { AuthorizationError } from "../utils/errors.js";

/**
 * Require a specific permission module for sub-admin access
 * Full admin bypass thic check. Sub-admins must have the module in their
 * permissions arrays.
 * 
 * @param {string} module - e.g "users", "therapists", "disputes", "bookings", "payments"
 */
export const requirePermission = (module) => {
    return async (req, res, next) => {
        try {
            const { user } = req;

            if (!user) {
                return next(new AuthorizationError("Authentication required"));
            }

            if (user.role === "admin") {
                return next();
            }

            // Sub-admins: look up their profile and check permissions
            if (user.role === "sub_admin") {
                const profile = await prisma.subAdminProfile.findUnique({
                    where: { userId: user.id },
                });

                if (!profile || !profile.isActive) {
                    return next(
                        new AuthorizationError(
                            "Your sub-admin account is inactive",
                            "ACCOUNT_INACTIVE"
                        )
                    );
                }

                if (!profile.permissions.includes(module)) {
                    return next(
                        new AuthorizationError(
                            `You do not have permission to access the '${module}' module`,
                            "INSUFFICIENT_PERMISSIONS"
                        )
                    )
                }

                req.subAdminProfile = profile;
                return next();
            }

            return next(new AuthorizationError("Access denied. Admin access required."));
        } catch (error) {
            next(error);
        }
    }
}