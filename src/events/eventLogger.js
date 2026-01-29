import { logger } from "../config/logger";

/**
 * Log system events for monitoring and observability
 * This integrates with Betterstack for event tracking
 */
export const logEvent = async (eventType, eventData = {}) => {
    try {
        const event = {
            event_type: eventType,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || "development",
            ...eventData
        };

        // Log to Winston (which can be configured to send to Betterstack)
        logger.info("System Event", event);

        // TODO: Send to Betterstack when configured
        // await sendToBetterStack(event)

        return { success: true, event };

    } catch (error) {
        logger.error("Failed to log event", {
            error: error.message,
            eventType,
            stack: error.stack
        });

        return { success: false, error: error.message };
    }
}
/**
 * Logs API requests for monitoring
 */
export const logApiRequest = async (req, res, duration) => {
    const eventData = {
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        duration_ms: duration,
        user_id: req.user?.id || null,
        ip_address: req.ip
    };

    await logEvent("api.request", eventData);
}

/**
 * Log errors with additional context
 */
export const logErrorEvent = async (error, context = {}) => {
    const eventData = {
        error_message: error.message,
        error_stack: error.stack,
        ...context
    };

    await logEvent("api.error", eventData);
}