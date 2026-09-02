import { STRIPE_CAPABILITY } from "./constants.js";
import { NonRetryableWebhookError } from "./errors.js";

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = "P2002";

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
    if (error?.code !== PRISMA_UNIQUE_CONSTRAINT_VIOLATION) return false;
    const target = error?.meta?.target;
    const parts = Array.isArray(target) ? target : [target].filter(Boolean);
    if (parts.length === 0) return false;
    return parts.some((part) =>
        typeof part === "string" &&
        (part.includes("stripe_event_id") || part.includes("processed_webhook_events"))
    );
};

/**
 * Classify a failed webhook handler so the controller can decide on retry.
 *
 * Stripe redelivers any non-2xx for up to three days. That is what we want for
 * transient faults (DB unavailable, Stripe timeout, network blip) because the event
 * carries money state that must not be silently dropped. So retry is the DEFAULT,
 * and only explicitly recognised deterministic failures are acknowledged instead.
 *
 * Deterministic failures are identified by type, never by matching message text —
 * a regex over error strings breaks the moment a message is reworded, and a false
 * match here permanently drops a real payment event.
 *
 * Deliberately NOT treated as non-retryable:
 *   - StripeInvalidRequestError: raised by our own OUTBOUND calls (a bad expand, a
 *     stale API shape). It fails identically until we ship a fix — and then Stripe's
 *     redelivery self-heals the payment. Acknowledging it would strand a captured
 *     payment whose booking was never confirmed.
 *   - StripeSignatureVerificationError: unreachable here. Signature checks run in an
 *     earlier try/catch that returns 400 before the handler switch.
 *
 * @param {object} error - Caught error from a webhook handler
 * @returns {{ shouldRetry: boolean, reason: string }} reason names the branch that fired, for logging
 */
export const classifyWebhookError = (error) => {
    if (isDuplicateWebhookEventError(error)) {
        return { shouldRetry: false, reason: "duplicate_event" };
    }
    if (error instanceof NonRetryableWebhookError) {
        return { shouldRetry: false, reason: "record_not_in_this_environment" };
    }
    return { shouldRetry: true, reason: "transient_or_unknown" };
};
