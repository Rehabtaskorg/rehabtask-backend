import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * Write an audit log entry for a user-initiated action.
 * Never throws — audit failure must not break the main operation.
 *
 * @param {object} opts
 * @param {string} opts.actorId   - User ID of the person performing the action
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

/**
 * Write an audit log entry for a system-triggered event (no user actor).
 * Used for webhook events, cron jobs, and automated processes.
 * Never throws — audit failure must not break the main operation.
 *
 * @param {object} opts
 * @param {string} opts.action     - Dot-notation action name, e.g. "payment.escrow_funded"
 * @param {string} opts.entityType - Entity type, e.g. "payment", "subscription"
 * @param {string} opts.entityId   - UUID of the affected entity
 * @param {object|null} opts.changes - Optional metadata payload
 */
export const logSystemEvent = async ({ action, entityType, entityId, changes = null }) => {
    try {
        await prisma.auditLog.create({
            data: { actorId: null, action, entityType, entityId, changes },
        });
    } catch (err) {
        logger.error("[AuditService] Failed to write system event", {
            error: err.message,
            action,
            entityType,
            entityId,
        });
    }
};
