import { STRIPE_CAPABILITY } from "./constants.js";

/**
 * Single source of truth for whether a Stripe Connect account is ready to
 * receive transfers AND pay out to a bank account.
 *
 * All three conditions must hold:
 * - details_submitted: the account holder has completed the embedded onboarding
 *   flow. Without this, no bank account is attached and any transfer lands in
 *   an unreachable Connect balance.
 * - capabilities.transfers === "active": Stripe permits the platform to call
 *   stripe.transfers.create() to this account. This is the direct gate on the
 *   API call made by payment.release.service.js and payment.refund.service.js.
 * - payouts_enabled: funds in the Connect balance will be paid out to the
 *   attached bank account. False when a payout bounces, a bank is removed, or
 *   Stripe initiates a periodic re-verification.
 *
 * These accounts are controller-properties accounts (not Standard), so Stripe
 * does not enforce details_submitted before allowing transfers. We enforce it
 * ourselves to prevent transfers into balances with no attached bank account.
 *
 * @param {object} account - Stripe Account object from accounts.retrieve() or account.updated webhook
 * @returns {boolean}
 */
export const isConnectAccountReady = (account) =>
    account?.details_submitted === true &&
    account?.capabilities?.transfers === STRIPE_CAPABILITY.ACTIVE &&
    account?.payouts_enabled === true;
