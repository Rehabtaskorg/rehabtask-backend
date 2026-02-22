import { Resend } from "resend";


// Resend is the production email provider
// In development, use src/config/mailer.js instead
export const resend = new Resend(process.env.RESEND_API_KEY)
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

export const emailConfig = {
    from: process.env.EMAIL_FROM || "RehabTask <noreply@rehabtask.com>",
    replyTo: process.env.EMAIL_REPLY_TO || "support@rehabtask.com",
    adminEmail: process.env.ADMIN_EMAIL || "admin@rehabtask.com",

    // Email templates types
    templates: {
        THERAPIST_REGISTRATION_PENDING: "therapist-registration-pending",
        THERAPIST_APPROVED: "therapist-approved",
        THERAPIST_REJECTED: "therapist-rejected",
        SUBSCRIPTION_ACTIVATED: "subscription-activated",
        SUBSCRIPTION_FAILED: "subscription-failed",
        NEW_REQUEST_NOTIFICATION: "new-request-notification",
        NEW_OFFER_NOTIFICATION: "new-offer-notification",
        OFFER_ACCEPTED: "offer-accepted",
        PAYMENT_CONFIRMATION: "payment-confirmation",
        SESSION_REMINDER: "session-reminder",
        SESSION_COMPLETION_REQUEST: "session-completion-request",
        SESSION_CONFIRMED: "session-confirmed",
        PAYOUT_CONFIRMATION: "payout-confirmation",
        PAYOUT_FAILED: "payout-failed",
    }
}

/**
 * Send email using Resend
 */
export const sendEmail = async ({ to, subject, html, text, replyTo }) => {
    try {
        const emailData = {
            from: emailConfig.from,
            to,
            subject,
            html,
            ...(text && { text }),
            ...(replyTo && { replyTo })
        };

        const response = await resend.emails.send(emailData);

        return {
            success: true,
            emailId: response.id,
            message: "Email sent successfully",
        };
    } catch (error) {
        console.error("Failed to send email:", error);
        return {
            success: false,
            error: error.message,
            message: "Failed to send email",
        };
    }
};

/**
 * Send bulk emails (batch sending)
 */
export const sendBulkEmails = async (emails) => {
    if (!resend) {
        console.warn('[email.js] Resend not configured — skipping bulk emails');
        return emails.map((email) => ({
            email: email.to,
            success: false,
            emailId: null,
            error: 'Resend not configured',
        }))
    }

    try {
        const emailPromises = emails.map((email) =>
            resend.emails.send({
                from: emailConfig.from,
                ...email
            })
        );

        const results = await Promise.allSettled(emailPromises);

        return results.map((result, index) => ({
            email: emails[index].to,
            success: result.status === "fulfilled",
            emailId: result.status === "fulfilled" ? result.value.id : null,
            error: result.status === "rejected" ? result.reason.message : null
        }));
    } catch (error) {
        console.error("Failed to send bulk emails:", error);
        throw error;
    }
}