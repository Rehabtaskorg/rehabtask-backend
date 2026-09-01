import { STRIPE_CAPABILITY } from "./constants.js";

/**
 * @param {object} account - Stripe Account object from accounts.retrieve() or account.updated webhook
 * @returns {boolean}
 */
export const isConnectAccountReady = (account) =>
    account?.details_submitted === true &&
    account?.capabilities?.transfers === STRIPE_CAPABILITY.ACTIVE &&
    account?.payouts_enabled === true;

/**
 * Detects the P2002 raised by markEventProcessed when a Stripe event has already
 * been recorded, so duplicate webhook deliveries can be treated as a no-op.
 *
 * ProcessedWebhookEvent.stripeEventId is the table's PRIMARY KEY, so Postgres
 * reports the constraint as "processed_webhook_events_pkey" rather than the
 * column name, and Prisma may surface meta.target as a string or an array.
 * Matching on either form keeps unrelated P2002s propagating normally.
 *
 * @param {object} error - Caught Prisma error
 * @returns {boolean}
 */
export const isDuplicateWebhookEventError = (error) => {
    if (error?.code !== "P2002") return false;
    const target = error?.meta?.target;
    const parts = Array.isArray(target) ? target : [target].filter(Boolean);
    if (parts.length === 0) return false;
    return parts.some((part) =>
        typeof part === "string" &&
        (part.includes("stripe_event_id") || part.includes("processed_webhook_events"))
    );
};
