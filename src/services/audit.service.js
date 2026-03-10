import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * Write an audit log entry for an admin action.
 * Never throws — audit failure must not break the main operation.
 *
 * @param {object} opts
 * @param {string} opts.actorId   - User ID of the admin performing the action
 * @param {string} opts.action    - Dot-notation action name, e.g. "payment.released"
 * @param {string} opts.entityType - Entity type, e.g. "payment", "booking"
 * @param {string} opts.entityId  - UUID of the affected entity
 * @param {object|null} opts.changes - Optional before/after diff payload
 */
export const logAction = async ({ actorId, action, entityType, entityId, changes = null }) => {
    try {
        await prisma.auditLog.create({
            data: { actorId, action, entityType, entityId, changes },
        });
    } catch (err) {
        logger.error("[AuditService] Failed to write audit log", {
            error: err.message,
            action,
            entityType,
            entityId,
        });
    }
};
