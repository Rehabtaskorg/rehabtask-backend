/**
 * All email templates — pure HTML string functions.
 * Each function receives props and returns { subject, html }.
 */
import {
    layout, heading, text, muted, button, hr, field, label, value,
    formatDate, formatCurrency, FRONTEND_URL
} from './layout.js';

// Therapist Registration Pending (admin + therapist versions)
export const therapistRegistrationPendingAdmin = ({ therapist }) => ({
    subject: 'New Therapist Registration — Review Required',
    html: layout(`
        ${heading('New Therapist Registration')}
        ${text('A new therapist has submitted a registration and is awaiting your review.')}
        ${hr()}
        ${field('Name', therapist.fullName)}
        ${field('License Type', therapist.primaryLicenseType || 'Not provided')}
        ${field('License State', therapist.licenseState || 'Not provided')}
        ${field('Email', therapist.email || therapist.user?.email || 'N/A')}
        ${hr()}
        ${button(`${FRONTEND_URL}/admin/therapists`, 'Review Application')}
    `),
});

export const therapistRegistrationPendingTherapist = ({ therapist }) => ({
    subject: 'Your RehabTask application has been received',
    html: layout(`
        ${heading('Application Received')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Thank you for applying to join RehabTask. We\'ve received your registration and our team is reviewing your application.')}
        ${text('This process typically takes <strong>2–5 business days</strong>. We\'ll email you as soon as a decision has been made.')}
        ${text('In the meantime, you can continue completing your profile to speed up the process.')}
        ${button(`${FRONTEND_URL}/therapist/onboarding`, 'Complete Your Profile')}
    `),
});

// Therapist Approved
export const therapistApproved = ({ therapist }) => ({
    subject: 'Congratulations — Your RehabTask profile is approved',
    html: layout(`
        ${heading(`Congratulations, ${therapist.fullName}!`)}
        ${text('Great news — your RehabTask profile has been reviewed and <strong>approved</strong>. Your profile is now live and visible to customers looking for therapy services.')}
        ${text('To start receiving payments for your sessions, please complete your Stripe Connect setup. This only takes a few minutes and is required before you can accept bookings.')}
        ${button(`${FRONTEND_URL}/therapist/onboarding`, 'Set Up Payments')}
        ${muted('If you have any questions about getting started, visit our Help Center or contact support.')}
    `),
});

// Therapist Rejected
export const therapistRejected = ({ therapist, reason }) => ({
    subject: 'Update on your RehabTask application',
    html: layout(`
        ${heading('Application Update')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Thank you for your interest in joining RehabTask. After reviewing your application, we\'re unable to approve your profile at this time.')}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${text('If you believe this was made in error or have questions, please don\'t hesitate to reach out to our support team.')}
        ${button(`${FRONTEND_URL}/contact`, 'Contact Support')}
    `),
});

// Subscription Activated
export const subscriptionActivated = ({ customer, subscription }) => ({
    subject: 'Your RehabTask subscription is active',
    html: layout(`
        ${heading('Subscription Active')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your RehabTask subscription is now active. You can start posting therapy requests and connecting with qualified therapists right away.')}
        ${hr()}
        ${field('Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${field('Renewal Date', formatDate(subscription.currentPeriodEnd))}
        ${hr()}
        ${button(`${FRONTEND_URL}/requests/new`, 'Post a Request')}
    `),
});

// New Request Notification (to therapist)
export const newRequestNotification = ({ therapist, request }) => {
    const truncatedDesc = request.description && request.description.length > 150
        ? request.description.slice(0, 150) + '...'
        : request.description;

    return {
        subject: 'New therapy request in your area',
        html: layout(`
            ${heading('New Therapy Request')}
            ${text(`Hi ${therapist.fullName},`)}
            ${text('A new therapy request matching your area has been posted. Review the details below and submit an offer if you\'re interested.')}
            ${hr()}
            ${field('Service Type', request.serviceType)}
            ${field('Location', request.location)}
            ${field('Preferred Date', formatDate(request.preferredDate))}
            ${truncatedDesc ? `${field('Description', truncatedDesc)}` : ''}
            ${hr()}
            ${button(`${FRONTEND_URL}/requests`, 'View Request')}
        `),
    };
};

// New Offer Notification (to customer)
export const newOfferNotification = ({ customer, therapist, offer }) => {
    const expiryDate = offer.expiresAt ? formatDate(offer.expiresAt) : null;

    return {
        subject: `${therapist.fullName} sent you a therapy offer`,
        html: layout(`
            ${heading('You Received an Offer')}
            ${text(`Hi ${customer.fullName},`)}
            ${text(`<strong>${therapist.fullName}</strong> has submitted an offer for your therapy request.`)}
            ${hr()}
            <p style="color:#2563EB;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(offer.rate)}</p>
            <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">per session</p>
            ${hr()}
            ${field('Session Type', offer.sessionType)}
            ${field('Proposed Date', formatDate(offer.proposedDate))}
            ${offer.description ? field('Details', offer.description) : ''}
            ${expiryDate ? `
                <p style="color:#b45309;font-size:13px;font-weight:500;background-color:#fffbeb;padding:10px 14px;border-radius:4px;border:1px solid #fde68a;">
                    This offer expires on ${expiryDate}.
                </p>
            ` : ''}
            ${button(`${FRONTEND_URL}/requests`, 'Review Offer')}
        `),
    };
};

// Offer Accepted (to therapist)
export const offerAccepted = ({ therapist, customer, booking }) => ({
    subject: 'Your offer has been accepted — booking confirmed',
    html: layout(`
        ${heading('Offer Accepted!')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`Great news — <strong>${customer.fullName}</strong> has accepted your offer and a booking has been confirmed.`)}
        ${hr()}
        ${field('Customer', customer.fullName)}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', booking.sessionType)}
        ${field('Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${text('Please make sure to prepare for the session and review the booking details.')}
        ${button(`${FRONTEND_URL}/therapist/bookings`, 'View Booking')}
    `),
});

// Payment Confirmation (to customer)
export const paymentConfirmation = ({ customer, booking, payment }) => ({
    subject: 'Payment confirmed — RehabTask receipt',
    html: layout(`
        ${heading('Payment Confirmed')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your payment has been successfully processed.')}
        ${hr()}
        <p style="color:#16a34a;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(payment.amount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Amount Paid</p>
        ${hr()}
        ${field('Therapist', booking.therapist?.fullName || 'N/A')}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', booking.sessionType)}
        ${field('Payment Date', formatDate(payment.createdAt))}
        ${hr()}
        ${button(`${FRONTEND_URL}/bookings/${booking.id}`, 'View Booking')}
        ${payment.stripePaymentIntentId ? `<p style="color:#8898aa;font-size:11px;text-align:center;margin-top:24px;">Transaction ID: ${payment.stripePaymentIntentId}</p>` : ''}
    `),
});

// Session Reminder (dual: customer + therapist)
export const sessionReminder = ({ recipient, booking, role }) => {
    const otherPartyName = role === 'customer'
        ? (booking.therapist?.fullName || 'your therapist')
        : (booking.customer?.fullName || 'your customer');

    const sessionTime = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';

    return {
        subject: role === 'customer'
            ? 'Reminder: Your therapy session is tomorrow'
            : `Reminder: Session with ${otherPartyName} is tomorrow`,
        html: layout(`
            ${heading('Session Reminder')}
            ${text(`Hi ${recipient.fullName},`)}
            ${text(role === 'customer'
            ? `This is a reminder that your session with ${otherPartyName} is scheduled for tomorrow.`
            : `You have a session tomorrow with ${otherPartyName}.`
        )}
            ${hr()}
            ${field('Date', formatDate(booking.scheduledDate))}
            ${sessionTime ? field('Time', sessionTime) : ''}
            ${field('Session Type', booking.sessionType)}
            ${hr()}
            ${button(`${FRONTEND_URL}/bookings/${booking.id}`, 'View Details')}
        `),
    };
};

// Session Completion Request (to customer)
export const sessionCompletionRequest = ({ customer, therapist, session, booking }) => ({
    subject: `${therapist.fullName} marked your session as complete — please confirm`,
    html: layout(`
        ${heading('Please Confirm Your Session')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${therapist.fullName}</strong> has marked your therapy session as complete. Please confirm that the session took place so we can process the therapist's payment.`)}
        ${hr()}
        ${field('Session Type', booking.sessionType)}
        ${field('Rate', formatCurrency(booking.rate))}
        ${field('Completed', formatDate(session.completedAt))}
        ${hr()}
        ${button(`${FRONTEND_URL}/bookings/${booking.id}`, 'Confirm Session')}
        ${muted('If not confirmed within 72 hours, the session will be auto-confirmed.')}
    `),
});

// Session Confirmed (to therapist)
export const sessionConfirmed = ({ therapist, customer, booking }) => ({
    subject: 'Session confirmed by customer — payout in progress',
    html: layout(`
        ${heading('Session Confirmed')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has confirmed the session. Your payout is now being processed.`)}
        ${hr()}
        ${field('Session Type', booking.sessionType)}
        ${field('Gross Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${muted('The final payout amount will reflect the platform fee deduction. You\'ll receive a separate confirmation once the payout has been sent to your Stripe account.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
    `),
});

// Payout Confirmation (to therapist)
export const payoutConfirmation = ({ therapist, payment, booking }) => ({
    subject: 'Your payout has been sent',
    html: layout(`
        ${heading('Payout Sent')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Your payout has been processed and sent to your connected Stripe account.')}
        ${hr()}
        <p style="color:#16a34a;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(payment.therapistPayout)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Net Payout</p>
        ${hr()}
        ${field('Session Type', booking.sessionType)}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${hr()}
        ${text('Funds typically arrive within 2–3 business days.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
        ${payment.stripeTransferId ? `<p style="color:#8898aa;font-size:11px;text-align:center;margin-top:24px;">Transfer ID: ${payment.stripeTransferId}</p>` : ''}
    `),
});

// New Message Notification
export const newMessageNotification = ({ senderName, message, contextType, contextId }) => {
    const truncatedContent = message.content && message.content.length > 200
        ? message.content.slice(0, 200) + '...'
        : message.content;

    return {
        subject: `New message from ${senderName}`,
        html: layout(`
            ${heading('New Message')}
            ${text(`You have a new message from <strong>${senderName}</strong>.`)}
            <div style="background-color:#f6f9fc;padding:16px;border-radius:6px;border-left:4px solid #2563EB;margin:20px 0;">
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${truncatedContent}</p>
            </div>
            ${message.patientId ? muted('Regarding a patient — view the full conversation in the app for details.') : ''}
            ${button(`${FRONTEND_URL}/messages/${contextType}/${contextId}`, 'Reply to Message')}
            ${hr()}
            <p style="color:#8898aa;font-size:11px;text-align:center;">
                You received this because you had no unread messages in this conversation.
            </p>
        `),
    };
};

// Offer declined (to therapist)
export const offerDeclined = ({ therapist, customer, offer }) => ({
    subject: 'Your offer was declined',
    html: layout(`
        ${heading('Offer Declined')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has reviewed and declined your offer for their therapy request.`)}
        ${hr()}
        ${field('Proposed Date', formatDate(offer.proposedDate))}
        ${field('Rate', formatCurrency(offer.rate))}
        ${field('Session Type', offer.sessionType)}
        ${hr()}
        ${text('You can continue submitting offers on other open requests.')}
        ${button(`${FRONTEND_URL}/therapist/requests`, 'Browse Requests')}
    `),
});

// Offer Withdrawn (to customer)
export const offerWithdrawn = ({ customer, therapist, offer }) => ({
    subject: `An offer on your request has been withdrawn`,
    html: layout(`
        ${heading('Offer Withdrawn')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${therapist.fullName}</strong> has withdrawn their offer for your therapy request.`)}
        ${hr()}
        ${field('Proposed Date', formatDate(offer.proposedDate))}
        ${field('Rate', formatCurrency(offer.rate))}
        ${hr()}
        ${text('Other therapists may still submit offers on your request.')}
        ${button(`${FRONTEND_URL}/requests`, 'View Your Requests')}
    `),
});

// Offer Change requested (to therapist)
export const offerChangeRequested = ({ therapist, customer, offer, note }) => ({
    subject: `${customer.fullName} requested changes to your offer`,
    html: layout(`
        ${heading('Change Requested')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has reviewed your offer and is requesting some changes before accepting.`)}
        ${hr()}
        ${field('Proposed Date', formatDate(offer.proposedDate))}
        ${field('Rate', formatCurrency(offer.rate))}
        ${field('Session Type', offer.sessionType)}
        ${hr()}
        <div style="background-color:#f6f9fc;padding:16px;border-radius:6px;border-left:4px solid #f59e0b;margin:20px 0;">
            <p style="color:#92400e;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 6px;">Customer's Note</p>
            <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${note}</p>
        </div>
        ${text('You can withdraw your current offer and submit a revised one, or reach out via messages to discuss.')}
        ${button(`${FRONTEND_URL}/therapist/offers`, 'View Offer')}
    `),
});

// Booking reschedule Proposed (to customer)
export const bookingRescheduleProposed = ({ customer, therapist, booking, newDate }) => ({
    subject: `${therapist.fullName} proposed a new session date`,
    html: layout(`
        ${heading('Reschedule Request')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${therapist.fullName}</strong> has proposed a new date for your upcoming session.`)}
        ${hr()}
        ${field('Current Date', formatDate(booking.scheduledDate))}
        ${field('Proposed New Date', formatDate(newDate))}
        ${field('Session Type', booking.sessionType)}
        ${field('Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${text('Please review and accept or decline the new proposed date.')}
        ${button(`${FRONTEND_URL}/bookings/${booking.id}`, 'Review Reschedule')}
    `),
});

// Booking reschedule accepted (to therapist)
export const bookingRescheduleAccepted = ({ therapist, booking }) => ({
    subject: 'Session reschedule accepted',
    html: layout(`
        ${heading('Reschedule Accepted')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Your client has accepted the new session date.')}
        ${hr()}
        ${field('New Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', booking.sessionType)}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings`, 'View Booking')}
    `),
});

// Account Deactivated
export const accountDeactivated = ({ user }) => ({
    subject: 'Your RehabTask account has been deactivated',
    html: layout(`
        ${heading('Account Deactivated')}
        ${text(`Hi ${user.displayName || user.email},`)}
        ${text('Your RehabTask account has been deactivated by an administrator. You will no longer be able to log in or access the platform.')}
        ${text('If you believe this was done in error, please contact our support team for assistance.')}
        ${button(`${FRONTEND_URL}/contact`, 'Contact Support')}
    `),
});

// Booking Reschedule Declined (to therapist)
export const bookingRescheduleDeclined = ({ therapist, booking, reason }) => ({
    subject: 'Session reschedule declined',
    html: layout(`
        ${heading('Reschedule Declined')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Your client has declined the proposed reschedule. The session will remain on the original date.')}
        ${hr()}
        ${field('Original Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', booking.sessionType)}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${button(`${FRONTEND_URL}/therapist/bookings`, 'View Booking')}
    `),
});