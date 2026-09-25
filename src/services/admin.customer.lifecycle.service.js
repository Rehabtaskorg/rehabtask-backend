import { APPROVAL_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendCustomerApproved, sendCustomerRejected } from "./email.service.js";
import { createTrialSubscription } from "./subscription.service.js";
import { logAction } from "./audit.service.js";

/**
 * Approve a customer. Guards against approving a half-finished application
 * and against double-approval. Sets approvedAt/approvedBy and clears any
 * prior rejection reason.
 *
 * @param {string} customerUserId
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export const approveCustomer = async (customerUserId, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        include: { customerProfile: true },
    });
    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");
    if (!user.customerProfile.onboardingComplete) {
        throw new BadRequestError("Cannot approve a customer who has not completed onboarding");
    }
    if (user.customerProfile.approvalStatus === APPROVAL_STATUS.APPROVED) {
        throw new ConflictError("Customer is already approved");
    }

    const customer = await prisma.customerProfile.update({
        where: { userId: customerUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.APPROVED,
            approvedAt: new Date(),
            approvedBy: adminId,
            rejectionReason: null,
            pendingReviewAt: null,
            reviewStartedAt: null,
        },
        select: {
            id: true,
            fullName: true,
            customerType: true,
            agencyName: true,
            approvalStatus: true,
            approvedAt: true,
            approvedBy: true,
            rejectionReason: true,
            pendingReviewAt: true,
            reviewStartedAt: true,
            user: { select: { id: true, email: true } },
        },
    });

    logAction({
        actorId: adminId,
        action: "customer.approved",
        entityType: "customer_profile",
        entityId: customer.id,
        changes: { customerType: customer.customerType },
    });

    const existingSub = await prisma.subscription.findFirst({
        where: { customerId: customer.id },
        select: { id: true },
    });
    if (!existingSub) {
        try {
            await createTrialSubscription(customer.id);
        } catch (err) {
            logger.error("[approveCustomer] Failed to create trial subscription", {
                customerUserId,
                customerId: customer.id,
                error: err.message,
            });
        }
    }

    sendCustomerApproved({ customer }).catch((err) =>
        logger.error("[approveCustomer] email failed", { error: err.message })
    );

    logger.info("[AdminCustomerService] Customer approved", {
        customerUserId,
        customerType: customer.customerType,
        byAdmin: adminId,
    });

    return customer;
};

/**
 * Reject a customer with a required reason of at least 10 characters.
 * Clears approvedAt/approvedBy so a previously approved customer does not
 * retain a stale approval trail after being rejected.
 *
 * @param {string} customerUserId
 * @param {string} reason
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export const rejectCustomer = async (customerUserId, reason, adminId) => {
    if (!reason || reason.trim().length < 10) {
        throw new BadRequestError("Rejection reason must be at least 10 characters");
    }

    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        include: { customerProfile: true },
    });
    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");
    if (user.customerProfile.approvalStatus === APPROVAL_STATUS.REJECTED) {
        throw new ConflictError("Customer is already rejected");
    }

    const trimmedReason = reason.trim();

    const customer = await prisma.customerProfile.update({
        where: { userId: customerUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.REJECTED,
            approvedAt: null,
            approvedBy: null,
            rejectionReason: trimmedReason,
            pendingReviewAt: null,
            reviewStartedAt: null,
        },
        select: {
            id: true,
            fullName: true,
            customerType: true,
            agencyName: true,
            approvalStatus: true,
            approvedAt: true,
            approvedBy: true,
            rejectionReason: true,
            pendingReviewAt: true,
            reviewStartedAt: true,
            user: { select: { id: true, email: true } },
        },
    });

    logAction({
        actorId: adminId,
        action: "customer.rejected",
        entityType: "customer_profile",
        entityId: customer.id,
        changes: { reason: trimmedReason },
    });

    sendCustomerRejected({ customer, reason: trimmedReason }).catch((err) =>
        logger.error("[rejectCustomer] email failed", { error: err.message })
    );

    logger.info("[AdminCustomerService] Customer rejected", {
        customerUserId,
        customerType: customer.customerType,
        byAdmin: adminId,
    });

    return customer;
};

/**
 * Clear a SOFT-tier re-review flag on an approved customer.
 * HARD-tier re-reviews (status flipped to `review`) go through approve/reject instead.
 */
export const clearCustomerReReview = async (customerUserId, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        include: { customerProfile: true },
    });
    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");

    const profile = user.customerProfile;
    if (profile.pendingReviewAt === null) {
        throw new ConflictError("This account has no pending re-review to clear");
    }
    if (profile.approvalStatus !== APPROVAL_STATUS.APPROVED) {
        throw new ConflictError(
            "This account is awaiting a full approval decision — use Approve or Reject instead"
        );
    }

    const customer = await prisma.customerProfile.update({
        where: { userId: customerUserId },
        data: { pendingReviewAt: null, reviewStartedAt: null },
        select: {
            id: true,
            fullName: true,
            customerType: true,
            agencyName: true,
            approvalStatus: true,
            pendingReviewAt: true,
            reviewStartedAt: true,
        },
    });

    logAction({
        actorId: adminId,
        action: "customer.re_review_cleared",
        entityType: "customer_profile",
        entityId: customer.id,
        changes: null,
    });

    logger.info("[AdminCustomerService] Re-review cleared", { customerUserId, byAdmin: adminId });

    return customer;
};
