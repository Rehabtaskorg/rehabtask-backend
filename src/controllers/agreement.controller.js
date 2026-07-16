import {
    recordAgreementAcceptance,
    getAgreementSectionsForRole,
} from "../services/agreement.service.js";
import { AGREEMENT_ROLE_SECTIONS } from "../utils/constants.js";

/**
 * POST /api/auth/agreement/accept
 * Records that the authenticated user has accepted the current unified agreement.
 *
 * @type {import("express").RequestHandler}
 */
export const acceptAgreementController = async (req, res, next) => {
    try {
        const { id: userId, role } = req.user;
        const ipAddress = req.ip ?? req.headers["x-forwarded-for"] ?? null;
        const userAgent = req.headers["user-agent"] ?? null;

        await recordAgreementAcceptance(userId, role, ipAddress, userAgent);

        res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/auth/agreement/content
 * Returns the role-filtered sections of the unified agreement for the authenticated user.
 *
 * @type {import("express").RequestHandler}
 */
export const getAgreementContentController = (req, res) => {
    const { role, customerProfile } = req.user;

    const resolvedRole = role === "customer"
        ? (customerProfile?.customerType === "agency" ? "agency" : "customer")
        : role;

    const validRole = AGREEMENT_ROLE_SECTIONS[resolvedRole] ? resolvedRole : "customer";
    const sections = getAgreementSectionsForRole(validRole);

    res.status(200).json({ success: true, data: { sections, role: validRole } });
};
