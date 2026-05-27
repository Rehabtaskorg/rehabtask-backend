import { PostHog } from "posthog-node";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Singleton PostHog client for server-side event tracking.
 * Null when POSTHOG_API_KEY is not configured (e.g. local dev without the key set).
 *
 * @type {PostHog | null}
 */
const posthogClient = env.POSTHOG_API_KEY
    ? new PostHog(env.POSTHOG_API_KEY, {
        host: "https://us.i.posthog.com",
        // Disable local evaluation / feature flags — we only need event capture
        disableGeoip: true,
    })
    : null;

/**
 * PHI-safe property block-list.
 * Any key in this set is stripped before the event is sent to PostHog.
 *
 * @type {Set<string>}
 */
const PHI_KEYS = new Set([
    "description", "location", "address", "content", "fullName",
    "first_name", "last_name", "email", "phone", "dob", "dateOfBirth",
    "reason", "revisionReason", "missedReason", "attemptedReason",
    "rejectionReason", "notes", "message", "patientName",
]);

/**
 * Strip PHI keys from an event properties object.
 *
 * @param {Record<string, unknown>} props
 * @returns {Record<string, unknown>}
 */
function sanitiseProps(props) {
    return Object.fromEntries(
        Object.entries(props).filter(([key]) => !PHI_KEYS.has(key))
    );
}

/**
 * Fire a server-side analytics event.
 *
 * Rules:
 * - Fire-and-forget: never throws, never awaited by callers.
 * - PHI-safe: strips all fields in PHI_KEYS before sending.
 * - No-op when POSTHOG_API_KEY is not set.
 *
 * @param {string} distinctId - The user's unique identifier (userId from DB).
 * @param {string} eventName  - The event name (e.g. "payment_confirmed").
 * @param {Record<string, unknown>} [properties={}] - Event properties (PHI will be stripped).
 * @returns {void}
 */
export function trackServerEvent(distinctId, eventName, properties = {}) {
    if (!posthogClient) return;

    try {
        posthogClient.capture({
            distinctId,
            event: eventName,
            properties: sanitiseProps(properties),
        });
    } catch (err) {
        // Never let analytics failures surface to callers
        logger.warn("PostHog capture error", { eventName, error: err?.message });
    }
}