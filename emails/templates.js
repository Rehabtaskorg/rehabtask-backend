/**
 * All email templates — pure HTML string functions.
 * Each function receives props and returns { subject, html }.
 */
import {
    layout, heading, text, muted, button, hr, field, label, value,
    formatDate, formatCurrency, formatSessionType, formatTherapistName, customerFields, FRONTEND_URL
} from './layout.js';

// Therapist Welcome (sent on account creation, before onboarding)
export const therapistWelcome = ({ therapist }) => ({
    subject: 'Welcome to RehabTask — Let\'s get you started',
    html: layout(`
        ${heading(`Welcome, ${therapist.fullName}!`)}
        ${text('Thank you for creating your RehabTask account. You\'re one step closer to connecting with customers who need your services.')}
        ${text('To complete your application, you\'ll need to:')}
        <ul style="color:#4a4a4a;font-size:14px;line-height:24px;margin:12px 0 20px 20px;">
            <li>Fill in your professional profile</li>
            <li>Upload your license credentials</li>
            <li>Set your availability and work areas</li>
            <li>Complete a background check consent</li>
        </ul>
        ${text('Once submitted, our team will review your application within <strong>2–5 business days</strong>.')}
        ${button(`${FRONTEND_URL}/therapist/onboarding/profile`, 'Start Your Application')}
    `),
});

// Therapist Application Submitted (sent after onboarding complete — to therapist)
export const therapistApplicationSubmitted = ({ therapist }) => ({
    subject: 'Your RehabTask application has been received',
    html: layout(`
        ${heading('Application Received')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('Thank you for completing your application. Our team has received it and will review your credentials shortly.')}
        ${text('This process typically takes <strong>2–5 business days</strong>. We\'ll email you as soon as a decision has been made.')}
        ${muted('No further action is needed from you at this time. You can set up your Stripe payment account in the meantime to get paid faster once approved.')}
    `),
});

// Therapist Application Submitted (sent after onboarding complete — to admin)
export const therapistApplicationSubmittedAdmin = ({ therapist }) => ({
    subject: 'New Therapist Application — Review Required',
    html: layout(`
        ${heading('New Therapist Application')}
        ${text('A therapist has completed their application and is awaiting your review.')}
        ${hr()}
        ${field('Name', therapist.fullName)}
        ${field('License Type', therapist.primaryLicenseType || 'Not provided')}
        ${field('License State', therapist.licenseState || 'Not provided')}
        ${field('Email', therapist.email || therapist.user?.email || 'N/A')}
        ${hr()}
        ${button(`${FRONTEND_URL}/admin/therapists`, 'Review Application')}
    `),
});

// Therapist Approved
export const therapistApproved = ({ therapist, stripeComplete }) => ({
    subject: 'Congratulations — Your RehabTask profile is approved',
    html: layout(`
        ${heading(`Congratulations, ${therapist.fullName}!`)}
        ${text('Great news — your RehabTask profile has been reviewed and <strong>approved</strong>. Your profile is now live and visible to customers looking for therapy services.')}
        ${stripeComplete
            ? `${text('Your payment account is already connected — you\'re all set to start accepting bookings right away.')}
               ${button(`${FRONTEND_URL}/therapist/dashboard`, 'Go to Dashboard')}`
            : `${text('To start receiving payments for your sessions, please complete your Stripe Connect setup. This only takes a few minutes and is required before you can accept bookings.')}
               ${button(`${FRONTEND_URL}/therapist/onboarding/stripe`, 'Set Up Payments')}`
        }
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
        ${button(`mailto:support@rehabtask.com`, 'Contact Support')}
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
        ${button(`${FRONTEND_URL}/customer/requests/new`, 'Post a Request')}
    `),
});

export const subscriptionUpgraded = ({ customer, subscription }) => ({
    subject: 'Your RehabTask plan has been upgraded',
    html: layout(`
        ${heading('Plan Upgraded')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your plan has been upgraded. The prorated charge for the remainder of your billing period has been applied.')}
        ${hr()}
        ${field('New Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${field('Next Renewal', formatDate(subscription.currentPeriodEnd))}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'View Subscription')}
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
            ${button(`${FRONTEND_URL}/therapist/requests/${request.id}`, 'View Request')}
        `),
    };
};

/**
 * Direct Request Notification — sent only to the single targeted therapist.
 * PHI fields are commented out pending BAA signature with Resend.
 * TODO: Uncomment PHI fields after BAA is signed with Resend.
 *
 * @param {{ therapist: { fullName: string }, request: { id: string } }} props
 * @returns {{ subject: string, html: string }}
 */
export const directRequestNotification = ({ therapist, request }) => {
    // const truncatedDesc = request.description && request.description.length > 150
    //     ? request.description.slice(0, 150) + '...'
    //     : request.description;

    return {
        subject: 'You have a new direct therapy request',
        html: layout(`
            ${heading('Direct Therapy Request')}
            ${text(`Hi ${therapist.fullName},`)}
            ${text('A customer has sent a therapy request directly to you. This request is private and only visible to you.')}
            ${text('Log in to view the full details and submit an offer if you\'re available.')}
            ${hr()}
            ${/* TODO: Uncomment after BAA is signed with Resend */ ''}
            ${/* field('Service Type', request.serviceType) */ ''}
            ${/* field('Location', request.location) */ ''}
            ${/* field('Preferred Date', formatDate(request.preferredDate)) */ ''}
            ${/* truncatedDesc ? field('Description', truncatedDesc) : '' */ ''}
            ${button(`${FRONTEND_URL}/therapist/requests/${request.id}`, 'View Request')}
        `),
    };
};

// New Offer Notification (to customer)
export const newOfferNotification = ({ customer, therapist, offer }) => {
    const expiryDate = offer.expiresAt ? formatDate(offer.expiresAt) : null;

    return {
        subject: `${formatTherapistName(therapist)} sent you a therapy offer`,
        html: layout(`
            ${heading('You Received an Offer')}
            ${text(`Hi ${customer.fullName},`)}
            ${text(`<strong>${formatTherapistName(therapist)}</strong> has submitted an offer for your therapy request.`)}
            ${hr()}
            <p style="color:#2563EB;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(offer.rate)}</p>
            <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">per session</p>
            ${hr()}
            ${field('Session Type', formatSessionType(offer.sessionType))}
            ${field('Proposed Date', formatDate(offer.proposedDate))}
            ${offer.description ? field('Details', offer.description) : ''}
            ${expiryDate ? `
                <p style="color:#b45309;font-size:13px;font-weight:500;background-color:#fffbeb;padding:10px 14px;border-radius:4px;border:1px solid #fde68a;">
                    This offer expires on ${expiryDate}.
                </p>
            ` : ''}
            ${button(`${FRONTEND_URL}/customer/requests/${offer.requestId}`, 'Review Offer')}
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
        ${customerFields(customer)}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${text('Please make sure to prepare for the session and review the booking details.')}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
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
        ${field('Therapist', formatTherapistName(booking.therapist))}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Payment Date', formatDate(payment.createdAt))}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'View Booking')}
        ${payment.stripePaymentIntentId ? `<p style="color:#8898aa;font-size:11px;text-align:center;margin-top:24px;">Transaction ID: ${payment.stripePaymentIntentId}</p>` : ''}
    `),
});

// Session Reminder (dual: customer + therapist)
export const sessionReminder = ({ recipient, booking, role }) => {
    const otherPartyLabel = role === 'customer'
        ? formatTherapistName(booking.therapist)
        : (booking.customer?.fullName || 'your customer');

    const sessionTime = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';

    return {
        subject: role === 'customer'
            ? 'Reminder: Your therapy session is tomorrow'
            : `Reminder: Session with ${otherPartyLabel} is tomorrow`,
        html: layout(`
            ${heading('Session Reminder')}
            ${text(`Hi ${recipient.fullName},`)}
            ${text(role === 'customer'
            ? `This is a reminder that your session with ${otherPartyLabel} is scheduled for tomorrow.`
            : `You have a session tomorrow with ${otherPartyLabel}.`
        )}
            ${hr()}
            ${field('Date', formatDate(booking.scheduledDate))}
            ${sessionTime ? field('Time', sessionTime) : ''}
            ${field('Session Type', formatSessionType(booking.sessionType))}
            ${hr()}
            ${button(`${FRONTEND_URL}/${role}/bookings/${booking.id}`, 'View Details')}
        `),
    };
};

// Session Completion Request (to customer)
export const sessionCompletionRequest = ({ customer, therapist, session, booking }) => ({
    subject: `${formatTherapistName(therapist)} marked your session as complete — please confirm`,
    html: layout(`
        ${heading('Please Confirm Your Session')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${formatTherapistName(therapist)}</strong> has marked your therapy session as complete. Please confirm that the session took place so we can process the therapist's payment.`)}
        ${hr()}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Rate', formatCurrency(booking.rate))}
        ${field('Completed', formatDate(session.completedAt))}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'Confirm Session')}
        ${muted('If not confirmed within 72 hours, the session will be auto-confirmed.')}
    `),
});

// Customer requested revision on a completed session (to therapist)
export const sessionRevisionRequested = ({ therapist, customer, session, booking, reason }) => ({
    subject: `${customer.fullName} requested a revision on your session`,
    html: layout(`
        ${heading('Revision Requested')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> reviewed the session you marked complete and would like some changes before confirming.`)}
        ${hr()}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Originally Completed', formatDate(session.completedAt))}
        ${hr()}
        ${label('What the customer wants changed')}
        ${value(`"${reason}"`)}
        ${hr()}
        ${text('Open the booking to upload any updated documentation in the chat, then resubmit the session with a date you can commit to.')}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
    `),
});

// Therapist resubmitted the session after a revision (to customer)
export const sessionRevisionSubmitted = ({ customer, therapist, session, booking }) => ({
    subject: `${formatTherapistName(therapist)} resubmitted your session — please review`,
    html: layout(`
        ${heading('Session Resubmitted')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${formatTherapistName(therapist)}</strong> has addressed your revision request and resubmitted the session. Please review the updates and confirm or request additional changes.`)}
        ${hr()}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${session.revisionDueBy ? field('Therapist commitment', formatDate(session.revisionDueBy)) : ''}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'Review Session')}
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
        ${customerFields(customer)}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Gross Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${muted('The final payout amount will reflect the platform fee deduction. You\'ll receive a separate confirmation once the payout has been sent to your Stripe account.')}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
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
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${hr()}
        ${text('Funds typically arrive within 2–3 business days.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
        ${payment.stripeTransferId ? `<p style="color:#8898aa;font-size:11px;text-align:center;margin-top:24px;">Transfer ID: ${payment.stripeTransferId}</p>` : ''}
    `),
});

// Payment released — notify customer that their payment has been transferred to the therapist
export const paymentReleasedToCustomer = ({ customer, therapist, payment, booking }) => ({
    subject: 'Your payment has been released',
    html: layout(`
        ${heading('Payment Released')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`Your session with ${therapist.fullName} has been confirmed and the payment has been released.`)}
        ${hr()}
        <p style="color:#137fec;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(payment.amount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Payment Released</p>
        ${hr()}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Therapist', formatTherapistName(therapist))}
        ${hr()}
        ${text('Thank you for using RehabTask. We hope your session went well!')}
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payments')}
    `),
});

// New Message Notification
export const newMessageNotification = ({ recipient, senderName, message, contextType, contextId }) => {
    const truncatedContent = message.content && message.content.length > 200
        ? message.content.slice(0, 200) + '...'
        : message.content;

    const messagesPath = recipient?.role === 'therapist' ? '/therapist/messages' : '/customer/messages';

    return {
        subject: `New message from ${senderName}`,
        html: layout(`
            ${heading('New Message')}
            ${text(`You have a new message from <strong>${senderName}</strong>.`)}
            <div style="background-color:#f6f9fc;padding:16px;border-radius:6px;border-left:4px solid #2563EB;margin:20px 0;">
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${truncatedContent}</p>
            </div>
            ${message.patientId ? muted('Regarding a patient — view the full conversation in the app for details.') : ''}
            ${button(`${FRONTEND_URL}${messagesPath}`, 'Reply to Message')}
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
        ${field('Session Type', formatSessionType(offer.sessionType))}
        ${hr()}
        ${text('You can continue submitting offers on other open requests.')}
        ${button(`${FRONTEND_URL}/therapist/requests/${offer.requestId}`, 'View Request')}
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
        ${button(`${FRONTEND_URL}/customer/requests/${offer.requestId}`, 'View Your Request')}
    `),
});

// Offer withdrawn due to request update (to therapist)
export const offersWithdrawnRequestUpdated = ({ therapist, customer, request }) => ({
    subject: `A request you offered on has been updated`,
    html: layout(`
        ${heading('Request Updated — Offer Withdrawn')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has updated their therapy request. Because the request details changed, your pending offer has been automatically withdrawn.`)}
        ${hr()}
        ${field('Service Type', request.serviceType)}
        ${field('Location', request.location)}
        ${hr()}
        ${text('You can review the updated request and submit a new offer if you\'re still interested.')}
        ${button(`${FRONTEND_URL}/therapist/requests`, 'Browse Requests')}
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
        ${field('Session Type', formatSessionType(offer.sessionType))}
        ${hr()}
        <div style="background-color:#f6f9fc;padding:16px;border-radius:6px;border-left:4px solid #f59e0b;margin:20px 0;">
            <p style="color:#92400e;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 6px;">Customer's Note</p>
            <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${note}</p>
        </div>
        ${text('You can withdraw your current offer and submit a revised one, or reach out via messages to discuss.')}
        ${button(`${FRONTEND_URL}/therapist/requests/${offer.requestId}`, 'View Request')}
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
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${field('Rate', formatCurrency(booking.rate))}
        ${hr()}
        ${text('Please review and accept or decline the new proposed date.')}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'Review Reschedule')}
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
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
    `),
});

// Dispute Status Update (to filer)
export const disputeStatusUpdate = ({ user, dispute, statusMessage }) => {
    const displayName =
        user.customerProfile?.fullName ||
        user.therapistProfile?.fullName ||
        user.email;

    const statusColors = {
        under_review: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', label: 'Under Review' },
        resolved: { bg: '#f0fdf4', border: '#22c55e', text: '#166534', label: 'Resolved' },
        closed: { bg: '#f8fafc', border: '#94a3b8', text: '#475569', label: 'Closed' },
    };
    const colors = statusColors[dispute.status] || statusColors.closed;

    return {
        subject: `Dispute #${dispute.ticketId} — ${colors.label}`,
        html: layout(`
            ${heading('Dispute Update')}
            ${text(`Hi ${displayName},`)}
            ${text(statusMessage)}
            ${hr()}
            ${field('Ticket ID', `#${dispute.ticketId}`)}
            ${field('Status', colors.label)}
            ${dispute.resolution ? `
                <div style="background-color:${colors.bg};border-left:4px solid ${colors.border};padding:16px;border-radius:4px;margin:20px 0;">
                    <p style="color:${colors.text};font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Resolution</p>
                    <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${dispute.resolution}</p>
                </div>
            ` : ''}
            ${hr()}
            ${button(`${FRONTEND_URL}/customer/disputes/${dispute.id}`, 'View Dispute')}
            ${muted('If you have further questions about this dispute, please contact our support team.')}
        `),
    };
};

// Dispute Reopened (to filer)
export const disputeReopened = ({ user, dispute }) => {
    const displayName =
        user.customerProfile?.fullName ||
        user.therapistProfile?.fullName ||
        user.email;

    return {
        subject: `Dispute #${dispute.ticketId} — Reopened`,
        html: layout(`
            ${heading('Dispute Reopened')}
            ${text(`Hi ${displayName},`)}
            ${text('Your dispute has been reopened and is now under review by our team. We\'ll follow up once we have an update.')}
            ${hr()}
            ${field('Ticket ID', `#${dispute.ticketId}`)}
            ${hr()}
            ${button(`${FRONTEND_URL}/customer/disputes/${dispute.id}`, 'View Dispute')}
        `),
    };
};

// Account Deactivated
export const accountDeactivated = ({ user }) => ({
    subject: 'Your RehabTask account has been deactivated',
    html: layout(`
        ${heading('Account Deactivated')}
        ${text(`Hi ${user.displayName || user.email},`)}
        ${text('Your RehabTask account has been deactivated by an administrator. You will no longer be able to log in or access the platform.')}
        ${text('If you believe this was done in error, please contact our support team for assistance.')}
        ${button(`mailto:support@rehabtask.com`, 'Contact Support')}
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
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
    `),
});

// Payment Failed (to customer)
export const paymentFailed = ({ customer, booking, reason }) => ({
    subject: 'Payment failed — action required',
    html: layout(`
        ${heading('Payment Failed')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Unfortunately, your payment could not be processed. Your booking has been cancelled.')}
        ${hr()}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${reason ? `${field('Reason', reason)}` : ''}
        ${hr()}
        ${text('Please try again with a different payment method or contact your bank for more details.')}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'View Booking')}
    `),
});

// Payout Failed (to therapist)
export const payoutFailed = ({ therapist, amount, reason }) => ({
    subject: 'Payout could not be delivered',
    html: layout(`
        ${heading('Payout Failed')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('We were unable to deliver your payout to your bank account.')}
        ${hr()}
        ${amount ? `
            <p style="color:#ef4444;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(amount)}</p>
            <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Failed Payout</p>
            ${hr()}
        ` : ''}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${text('Please verify your bank account details in your Stripe dashboard. Stripe will automatically retry the payout.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
    `),
});

// Admin released payment — notify therapist
export const adminPaymentReleased = ({ therapist, amount, booking }) => ({
    subject: 'Payment released to your account',
    html: layout(`
        ${heading('Payment Released')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('A payment has been released to your Stripe account by an administrator.')}
        ${hr()}
        <p style="color:#137fec;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(amount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Released to your account</p>
        ${hr()}
        ${booking ? field('Session Date', formatDate(booking.scheduledDate)) : ''}
        ${booking ? field('Session Type', formatSessionType(booking.sessionType)) : ''}
        ${text('The funds will be deposited into your connected bank account according to your Stripe payout schedule.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
    `),
});

// Admin refunded payment — notify customer
export const adminPaymentRefunded = ({ customer, amount, booking, reason }) => ({
    subject: 'Your payment has been refunded',
    html: layout(`
        ${heading('Payment Refunded')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('A refund has been processed for your booking.')}
        ${hr()}
        <p style="color:#137fec;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(amount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Refund Amount</p>
        ${hr()}
        ${booking ? field('Session Date', formatDate(booking.scheduledDate)) : ''}
        ${booking ? field('Session Type', formatSessionType(booking.sessionType)) : ''}
        ${reason ? `
            <div style="background-color:#eff6ff;border-left:4px solid #3b82f6;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#1e40af;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${text('The refund will appear on your original payment method within 5–10 business days.')}
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payments')}
    `),
});

// Booking cancelled by admin — notify customer or therapist
export const bookingCancelledByAdmin = ({ recipientName, booking, reason, role }) => ({
    subject: 'Your booking has been cancelled',
    html: layout(`
        ${heading('Booking Cancelled')}
        ${text(`Hi ${recipientName},`)}
        ${text('An administrator has cancelled the following booking:')}
        ${hr()}
        ${field('Session Date', formatDate(booking.scheduledDate))}
        ${field('Session Type', formatSessionType(booking.sessionType))}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${text('If you have any questions about this cancellation, please contact our support team.')}
        ${button(`${FRONTEND_URL}/${role === 'customer' ? 'customer' : 'therapist'}/bookings/${booking.id}`, 'View Booking')}
    `),
});

// Subscription cancelled by admin — notify customer
export const subscriptionCancelledByAdmin = ({ customer, subscription }) => ({
    subject: 'Your RehabTask subscription has been cancelled',
    html: layout(`
        ${heading('Subscription Cancelled')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your RehabTask subscription has been cancelled by an administrator.')}
        ${hr()}
        ${field('Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${text('You will retain access to your account but will no longer have an active subscription. If you believe this was done in error or have questions, please contact our support team.')}
        ${button(`${FRONTEND_URL}/customer/requests`, 'Go to Dashboard')}
    `),
});

// Commission rate changed — notify therapist
export const commissionRateChanged = ({ therapist, tier, oldRate, newRate, effectiveFrom }) => ({
    subject: 'Platform commission rate update',
    html: layout(`
        ${heading('Commission Rate Updated')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text('The platform commission rate for your plan tier has been updated. This will apply to all future payments.')}
        ${hr()}
        ${field('Plan Tier', tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'All Tiers')}
        ${field('Previous Rate', `${(oldRate * 100).toFixed(1)}%`)}
        ${field('New Rate', `${(newRate * 100).toFixed(1)}%`)}
        ${field('Effective From', formatDate(effectiveFrom))}
        ${hr()}
        ${text('Payments that have already been created are not affected — only new payments from the effective date onward will use the updated rate.')}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
    `),
});

// Sub-Admin Welcome (sent when invite is accepted and account is activated)
export const subAdminWelcome = ({ user }) => ({
    subject: 'Your RehabTask admin account is ready',
    html: layout(`
        ${heading('Welcome to the Admin Team')}
        ${text(`Hi ${user.email},`)}
        ${text('Your RehabTask sub-admin account has been successfully set up. You now have access to the admin dashboard.')}
        ${text('You can log in at any time using your email address and the password you just created.')}
        ${button(`${FRONTEND_URL}/login`, 'Go to Dashboard')}
        ${muted('If you have any questions or need help getting started, contact your administrator.')}
    `),
});

// Payment reminder — sent when booking is "accepted" (unpaid) and session date approaches
export const paymentReminder = ({ customer, therapist, booking, hoursUntilSession }) => {
    const timeLabel = hoursUntilSession <= 24 ? 'tomorrow' : 'in 2 days';
    const urgency = hoursUntilSession <= 24
        ? 'Please complete payment as soon as possible to confirm your session.'
        : 'Complete payment to confirm your upcoming session.';

    return {
        subject: `Payment needed — Your session is ${timeLabel}`,
        html: layout(`
            ${heading('Payment Reminder')}
            ${text(`Hi ${customer.fullName},`)}
            ${text(`Your session with ${formatTherapistName(therapist)} is scheduled for <strong>${timeLabel}</strong> but payment has not been completed yet.`)}
            ${hr()}
            ${field('Therapist', formatTherapistName(therapist))}
            ${field('Session Date', formatDate(booking.scheduledDate))}
            ${field('Rate', formatCurrency(booking.rate))}
            ${hr()}
            ${text(urgency)}
            ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'Complete Payment')}
            ${muted('Your payment will be held securely in escrow until you confirm session completion. If you need to reschedule, you can do so from the booking detail page.')}
        `),
    };
};

// ─── Subscription Lifecycle Templates ────────────────────────────────────────

// Trial expiring soon (sent 3 days before trial ends)
export const trialExpiringSoon = ({ customer, daysLeft }) => ({
    subject: `Your RehabTask trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: layout(`
        ${heading('Your Free Trial Is Ending Soon')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`Your 30-day free trial of RehabTask Standard features ends in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.`)}
        ${text('After your trial, your account will revert to the Free plan with limited requests and therapist connections.')}
        ${text('Upgrade now to keep your current features and avoid any disruption:')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'View Plans & Upgrade')}
        ${muted('If you have any questions about our plans, please contact our support team.')}
    `),
});

// Trial expired (sent when trial auto-downgrades to free)
export const trialExpired = ({ customer }) => ({
    subject: 'Your RehabTask trial has ended',
    html: layout(`
        ${heading('Trial Period Ended')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your 30-day free trial has ended. Your account has been moved to the <strong>Free plan</strong>.')}
        ${hr()}
        ${field('Current Plan', 'Free')}
        ${field('Request Limit', '5 active requests')}
        ${field('Therapist Limit', '5 active therapists')}
        ${hr()}
        ${text('You can upgrade at any time to unlock more features:')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'Upgrade Your Plan')}
    `),
});

// Subscription payment failed
export const subscriptionPaymentActionRequired = ({ customer, hostedInvoiceUrl }) => ({
    subject: 'Action required — verify your payment to continue your RehabTask subscription',
    html: layout(`
        ${heading('Payment Verification Required')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your subscription renewal requires a one-time verification step from your bank. Your card has not been declined — this is a security check required by your bank.')}
        ${text('Please complete the verification to keep your plan active. This only takes a moment.')}
        ${button(hostedInvoiceUrl, 'Complete Verification')}
        ${hr()}
        ${muted('If you did not initiate this, please contact our support team. Your subscription will remain active while we await verification.')}
    `),
});

export const subscriptionPaymentFailed = ({ customer }) => ({
    subject: 'Action needed — your RehabTask payment failed',
    html: layout(`
        ${heading('Payment Failed')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('We were unable to process your subscription payment. Please update your payment method to keep your plan active.')}
        ${text('If the issue isn\'t resolved, your plan will be downgraded after a short grace period.')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'Update Payment Method')}
        ${muted('If you believe this is an error, please check with your bank or contact our support team.')}
    `),
});

// Subscription cancelled by customer
export const subscriptionCancelledByCustomer = ({ customer, subscription }) => ({
    subject: 'Your RehabTask subscription has been cancelled',
    html: layout(`
        ${heading('Subscription Cancelled')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your subscription cancellation has been confirmed. You\'ll continue to have access to your current plan until the end of your billing period.')}
        ${hr()}
        ${field('Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${field('Access Until', formatDate(subscription.currentPeriodEnd))}
        ${hr()}
        ${text('After this date, your account will move to the Free plan. You can resubscribe at any time.')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'Resubscribe')}
    `),
});

// Subscription downgraded (after grace period expires)
export const subscriptionDowngraded = ({ customer }) => ({
    subject: 'Your RehabTask plan has been downgraded',
    html: layout(`
        ${heading('Plan Downgraded to Free')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your subscription grace period has ended and your account has been moved to the <strong>Free plan</strong>.')}
        ${hr()}
        ${field('Current Plan', 'Free')}
        ${field('Request Limit', '5 active requests')}
        ${field('Therapist Limit', '5 active therapists')}
        ${hr()}
        ${text('Your existing requests and bookings are not affected, but you won\'t be able to create new ones beyond the Free plan limits.')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'Upgrade Your Plan')}
    `),
});

export const subscriptionResumed = ({ customer, subscription }) => ({
    subject: 'Your RehabTask subscription has been resumed',
    html: layout(`
        ${heading('Subscription Resumed')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your subscription cancellation has been reversed. Your plan will continue as normal.')}
        ${hr()}
        ${field('Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${field('Next Renewal', formatDate(subscription.currentPeriodEnd))}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'View Subscription')}
    `),
});

export const subscriptionDowngradeScheduled = ({ customer, subscription, targetPlan }) => ({
    subject: 'Your RehabTask plan downgrade has been scheduled',
    html: layout(`
        ${heading('Plan Downgrade Scheduled')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your plan downgrade has been scheduled. You\'ll keep full access to your current plan until the end of your billing period.')}
        ${hr()}
        ${field('Current Plan', subscription.planType ? subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1) : 'N/A')}
        ${field('Downgrading To', targetPlan ? targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1) : 'N/A')}
        ${field('Effective Date', formatDate(subscription.currentPeriodEnd))}
        ${hr()}
        ${text('Changed your mind? You can cancel the scheduled downgrade from your subscription page.')}
        ${button(`${FRONTEND_URL}/customer/subscription`, 'Manage Subscription')}
    `),
});

// Existing Account Notification (sent when someone tries to register with an email that already exists)
export const existingAccountNotification = ({ email, resetLink }) => ({
    subject: 'Sign-in attempt for your RehabTask account',
    html: layout(`
        ${heading('Someone tried to create an account with your email')}
        ${text('We received a registration request using this email address, but you already have a RehabTask account.')}
        ${text('If this was you, you can log in to your existing account:')}
        ${button(`${FRONTEND_URL}/login`, 'Log In to Your Account')}
        ${hr()}
        ${text('If you\'ve forgotten your password, you can reset it here:')}
        ${button(resetLink, 'Reset Your Password')}
        ${hr()}
        ${muted('If you didn\'t attempt to register, you can safely ignore this email. Your account is secure and no changes have been made.')}
    `),
});

// ── Customer Refund Emails ──

// Refund Available — sent when a booking is finalized and a refund is created
export const customerRefundAvailable = ({ customer, therapist, refundAmount, bookingId }) => ({
    subject: `You have a refund of ${formatCurrency(refundAmount)} available`,
    html: layout(`
        ${heading('You Have a Refund Available')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`A booking with ${therapist.fullName} was finalized early, and you are owed a refund for the undelivered sessions.`)}
        ${hr()}
        <p style="color:#137fec;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Refund Available</p>
        ${hr()}
        ${text('To receive this refund directly to your bank account, set up your payout account. It only takes a few minutes.')}
        ${button(`${FRONTEND_URL}/customer/payout-setup`, 'Set Up Payout Account')}
    `),
});

// Refund Reminder — sent at day 7 and day 14
export const customerRefundReminder = ({ customer, refundAmount }) => ({
    subject: `Reminder: Your ${formatCurrency(refundAmount)} refund is waiting`,
    html: layout(`
        ${heading('Your Refund is Still Waiting')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`You have ${formatCurrency(refundAmount)} in pending refunds. Set up your payout account to receive the funds directly to your bank account.`)}
        ${hr()}
        <p style="color:#137fec;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/payout-setup`, 'Set Up Payout Account')}
    `),
});

// Refund Transferred — sent when refund is transferred to customer's Connect account
export const customerRefundTransferred = ({ customer, refundAmount }) => ({
    subject: `Your refund of ${formatCurrency(refundAmount)} has been sent`,
    html: layout(`
        ${heading('Refund Sent to Your Account')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Your refund has been sent to your linked bank account. It should arrive within 2-3 business days.')}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#059669;font-size:13px;font-weight:600;text-align:center;margin:4px 0 0;">Refund Sent</p>
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payment History')}
        ${hr()}
        ${muted('If you have any questions about this refund, please contact our support team.')}
    `),
});

// Refund Returned to Card — sent when the 30-day fallback kicks in
export const customerRefundReturnedToCard = ({ customer, refundAmount }) => ({
    subject: `Your refund of ${formatCurrency(refundAmount)} has been returned to your card`,
    html: layout(`
        ${heading('Refund Returned to Your Card')}
        ${text(`Hi ${customer.fullName},`)}
        ${text('Since a payout account was not set up within 30 days, your refund has been returned to your original payment method.')}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Returned to Original Payment Method</p>
        ${hr()}
        ${text('The refund should appear on your statement within 5-10 business days, depending on your bank.')}
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payment History')}
    `),
});

export const customerRefundPayoutFailed = ({ customer, refundAmount, reason }) => ({
    subject: `Action required — your refund of ${formatCurrency(refundAmount)} could not be delivered`,
    html: layout(`
        ${heading('Refund Delivery Failed')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`We attempted to send your refund of ${formatCurrency(refundAmount)} to your linked bank account, but the transfer was unsuccessful.`)}
        ${hr()}
        <p style="color:#ef4444;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Could Not Be Delivered</p>
        ${hr()}
        ${reason ? `
            <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:20px 0;">
                <p style="color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 4px;">Reason</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${reason}</p>
            </div>
        ` : ''}
        ${text('Your refund is still available. Please update your bank account details and we will automatically retry the transfer.')}
        ${button(`${FRONTEND_URL}/customer/payout-setup`, 'Update Bank Account')}
        ${hr()}
        ${muted('If you have questions about this refund, please contact our support team.')}
    `),
});

// Stripe requirements alert — sent when account.updated webhook fires with new requirements
export const stripeRequirementsAlert = ({ therapist, pastDueCount, currentlyDueCount, currentDeadline, hasUpcomingRequirements, futureDeadline }) => {
    const isPastDue = pastDueCount > 0;
    const isCurrentlyDue = currentlyDueCount > 0;

    const subject = isPastDue
        ? 'Action required — your RehabTask payout account has been restricted'
        : isCurrentlyDue
            ? `Action needed by ${currentDeadline ? new Date(currentDeadline * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'upcoming deadline'} to keep your payout account active`
            : 'Upcoming information required for your RehabTask payout account';

    const urgencyColor = isPastDue ? '#dc2626' : isCurrentlyDue ? '#d97706' : '#2563EB';
    const urgencyBg = isPastDue ? '#fef2f2' : isCurrentlyDue ? '#fffbeb' : '#eff6ff';
    const urgencyBorder = isPastDue ? '#fca5a5' : isCurrentlyDue ? '#fcd34d' : '#bfdbfe';

    const deadlineStr = currentDeadline
        ? new Date(currentDeadline * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : null;

    const futureDeadlineStr = futureDeadline
        ? new Date(futureDeadline * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;

    const bodyContent = isPastDue
        ? `Your payout account has been <strong>restricted by Stripe</strong> because required information was not provided by the deadline. Your ability to receive payments and payouts is currently paused.`
        : isCurrentlyDue
            ? `Stripe requires updated information for your payout account${deadlineStr ? ` by <strong>${deadlineStr}</strong>` : ' soon'}. If not completed, your payments and payouts will be paused.`
            : `Stripe will require new information for your payout account${futureDeadlineStr ? ` by <strong>${futureDeadlineStr}</strong>` : ' in the future'}. Completing it now ensures no interruption to your earnings.`;

    return {
        subject,
        html: layout(`
            ${heading(isPastDue ? 'Payout Account Restricted' : isCurrentlyDue ? 'Action Required' : 'Upcoming Requirements')}
            ${text(`Hi ${therapist.fullName},`)}
            <div style="background-color:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:8px;padding:16px 20px;margin:20px 0;">
                <p style="color:${urgencyColor};font-size:14px;font-weight:600;margin:0 0 6px;">${isPastDue ? '⚠️ Account restricted' : isCurrentlyDue ? '⏰ Deadline approaching' : 'ℹ️ Upcoming requirement'}</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${bodyContent}</p>
            </div>
            ${text('To resolve this, log in to RehabTask and complete your payout account information. The process takes just a few minutes.')}
            ${button(`${FRONTEND_URL}/therapist/onboarding/stripe`, isPastDue ? 'Restore My Account' : 'Complete Required Information')}
            ${hr()}
            ${muted('If you have questions about what information Stripe requires, the form will show you exactly what is needed. If you need help, contact our support team.')}
        `),
    };
};

// Customer Stripe requirements alert — payout account for refunds
export const customerStripeRequirementsAlert = ({ customer, pastDueCount, currentlyDueCount, currentDeadline, hasUpcomingRequirements, futureDeadline }) => {
    const isPastDue = pastDueCount > 0;
    const isCurrentlyDue = currentlyDueCount > 0;

    const subject = isPastDue
        ? 'Action required — your RehabTask refund account has been restricted'
        : isCurrentlyDue
            ? `Action needed by ${currentDeadline ? new Date(currentDeadline * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'upcoming deadline'} to keep your refund account active`
            : 'Upcoming information required for your RehabTask refund account';

    const urgencyColor = isPastDue ? '#dc2626' : isCurrentlyDue ? '#d97706' : '#2563EB';
    const urgencyBg = isPastDue ? '#fef2f2' : isCurrentlyDue ? '#fffbeb' : '#eff6ff';
    const urgencyBorder = isPastDue ? '#fca5a5' : isCurrentlyDue ? '#fcd34d' : '#bfdbfe';

    const deadlineStr = currentDeadline
        ? new Date(currentDeadline * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : null;

    const futureDeadlineStr = futureDeadline
        ? new Date(futureDeadline * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;

    const customerName = customer.fullName || customer.agencyName || 'there';

    const bodyContent = isPastDue
        ? `Your refund payout account has been <strong>restricted by Stripe</strong> because required information was not provided by the deadline. Your ability to receive refunds is currently paused.`
        : isCurrentlyDue
            ? `Stripe requires updated information for your refund account${deadlineStr ? ` by <strong>${deadlineStr}</strong>` : ' soon'}. If not completed, your ability to receive refunds will be paused.`
            : `Stripe will require new information for your refund account${futureDeadlineStr ? ` by <strong>${futureDeadlineStr}</strong>` : ' in the future'}. Completing it now ensures you can always receive refunds without interruption.`;

    return {
        subject,
        html: layout(`
            ${heading(isPastDue ? 'Refund Account Restricted' : isCurrentlyDue ? 'Action Required' : 'Upcoming Requirements')}
            ${text(`Hi ${customerName},`)}
            <div style="background-color:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:8px;padding:16px 20px;margin:20px 0;">
                <p style="color:${urgencyColor};font-size:14px;font-weight:600;margin:0 0 6px;">${isPastDue ? '⚠️ Account restricted' : isCurrentlyDue ? '⏰ Deadline approaching' : 'ℹ️ Upcoming requirement'}</p>
                <p style="color:#1a1a1a;font-size:14px;line-height:22px;margin:0;">${bodyContent}</p>
            </div>
            ${text('Log in to RehabTask and complete your refund account information. The process takes just a few minutes.')}
            ${button(`${FRONTEND_URL}/customer/payout-setup`, isPastDue ? 'Restore My Account' : 'Complete Required Information')}
            ${hr()}
            ${muted('Your refund payout account is separate from your payment method. It is used only to receive refunds when sessions are cancelled or missed.')}
        `),
    };
};

// Attempted Visit — therapist payout notification
export const attemptedVisitTherapistPayout = ({ therapist, customer, session, booking, grossAmount, refundAmount }) => ({
    subject: `Attempted visit payout: ${formatCurrency(grossAmount)} released`,
    html: layout(`
        ${heading('Attempted Visit Payout')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`You recorded an attempted visit for your session with ${customer.fullName}. Your attempted visit fee has been released from escrow.`)}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(grossAmount)}</p>
        <p style="color:#6b7280;font-size:13px;text-align:center;margin:4px 0 0;">Released (before commission)</p>
        ${hr()}
        ${text(`The remaining ${formatCurrency(refundAmount)} from this session has been refunded to the customer.`)}
        ${button(`${FRONTEND_URL}/therapist/earnings`, 'View Earnings')}
        ${hr()}
        ${muted('Commission is applied at payout time. Net amount will reflect on your earnings page.')}
    `),
});

// ─── Cancellation Flow ────────────────────────────────────────────────────────

export const cancellationRequestedToTherapist = ({ therapist, customer, booking, reason }) => ({
    subject: `Action required: ${customer.fullName} has requested to cancel their booking`,
    html: layout(`
        ${heading('Cancellation Request')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has requested to cancel their booking. You have <strong>24 hours</strong> to approve or reject this request. If you don't respond, the cancellation will be approved automatically.`)}
        ${hr()}
        ${customerFields(customer)}
        ${field('Reason', reason || 'No reason provided')}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'Review Request')}
        ${muted('If you take no action within 24 hours, the booking will be cancelled and the customer will receive a full refund.')}
    `),
});

export const cancellationApprovedToCustomer = ({ customer, therapist, booking, refundAmount, refundMethod }) => ({
    subject: 'Your cancellation has been approved',
    html: layout(`
        ${heading('Cancellation Approved')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`Your cancellation request for your booking with <strong>${therapist.fullName}</strong> has been approved.`)}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#059669;font-size:13px;font-weight:600;text-align:center;margin:4px 0 0;">Full Refund</p>
        ${hr()}
        ${refundMethod === 'transferred'
            ? text('Your refund has been sent to your linked bank account and should arrive within 2–3 business days.')
            : `${text('To receive your refund, set up your payout account. It only takes a few minutes.')}${button(`${FRONTEND_URL}/customer/payout-setup`, 'Set Up Payout Account')}`
        }
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payment History')}
    `),
});

export const cancellationRejectedToCustomer = ({ customer, therapist, booking, rejectionReason }) => ({
    subject: 'Your cancellation request was not approved',
    html: layout(`
        ${heading('Cancellation Request Declined')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`Your therapist <strong>${therapist.fullName}</strong> has declined your cancellation request. Your booking remains active.`)}
        ${hr()}
        ${field('Reason', rejectionReason || 'No reason provided')}
        ${hr()}
        ${text('If you have further questions, please contact your therapist directly through the platform.')}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'View Booking')}
        ${muted('If you believe this decision is incorrect, please contact our support team.')}
    `),
});

export const cancellationRequestedToCustomer = ({ therapist, customer, booking, reason }) => ({
    subject: `Action required: ${therapist.fullName} has requested to cancel your booking`,
    html: layout(`
        ${heading('Cancellation Request')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`<strong>${therapist.fullName}</strong> has requested to cancel your booking. You have <strong>24 hours</strong> to approve or reject this request. If you don't respond, the request will be automatically declined and your booking will remain active.`)}
        ${hr()}
        ${field('Therapist', therapist.fullName)}
        ${field('Reason', reason || 'No reason provided')}
        ${hr()}
        ${button(`${FRONTEND_URL}/customer/bookings/${booking.id}`, 'Review Request')}
        ${muted("If you approve, you'll receive a full refund. If you take no action within 24 hours, the request will be declined and your booking remains active.")}
    `),
});

export const cancellationApprovedToTherapist = ({ customer, therapist, booking, refundAmount }) => ({
    subject: 'Your cancellation request was approved',
    html: layout(`
        ${heading('Cancellation Approved')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> approved your request to cancel this booking. The customer has been refunded ${formatCurrency(refundAmount)}.`)}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
    `),
});

export const cancellationRejectedToTherapist = ({ customer, therapist, booking, rejectionReason }) => ({
    subject: 'Your cancellation request was not approved',
    html: layout(`
        ${heading('Cancellation Request Declined')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> has declined your cancellation request. The booking remains active.`)}
        ${hr()}
        ${field('Reason', rejectionReason || 'No reason provided')}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
        ${muted('If you have further questions, please contact the customer directly through the platform.')}
    `),
});

export const emailVerification = ({ verificationLink }) => ({
    subject: 'Verify your RehabTask email address',
    html: layout(`
        ${heading('Verify Your Email Address')}
        ${text('Thanks for signing up for RehabTask. Please verify your email address to activate your account.')}
        ${button(verificationLink, 'Verify Email Address')}
        ${hr()}
        ${muted('This link expires in 24 hours. If you did not create a RehabTask account, you can safely ignore this email.')}
    `),
});

export const passwordReset = ({ resetLink }) => ({
    subject: 'Reset your RehabTask password',
    html: layout(`
        ${heading('Reset Your Password')}
        ${text('We received a request to reset the password for your RehabTask account.')}
        ${button(resetLink, 'Reset Password')}
        ${hr()}
        ${muted('This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email. Your password will not change.')}
    `),
});

export const subAdminInvite = ({ inviteLink }) => ({
    subject: 'You have been invited to RehabTask as a sub-admin',
    html: layout(`
        ${heading('You\'ve Been Invited')}
        ${text('You have been invited to join RehabTask as a sub-administrator. Click the button below to accept your invitation and set up your account.')}
        ${button(inviteLink, 'Accept Invitation')}
        ${hr()}
        ${muted('This invitation link expires in 24 hours. If you were not expecting this invitation, you can safely ignore this email.')}
    `),
});

export const cancellationAutoDeclinedToTherapist = ({ customer, therapist, booking }) => ({
    subject: 'Your cancellation request expired',
    html: layout(`
        ${heading('Cancellation Request Expired')}
        ${text(`Hi ${therapist.fullName},`)}
        ${text(`<strong>${customer.fullName}</strong> did not respond to your cancellation request within 24 hours. The request has been automatically declined and the booking remains active.`)}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'View Booking')}
        ${muted('If you still wish to cancel this booking, you can submit a new request.')}
    `),
});

// ─── Session Cancellation Flow ────────────────────────────────────────────────

export const sessionCancellationRequestedToOtherParty = ({ recipient, requester, session, booking, reason, deadlineStr }) => ({
    subject: `Action required: ${requester.fullName} wants to cancel Session ${session.sessionNumber}`,
    html: layout(`
        ${heading('Session Cancellation Request')}
        ${text(`Hi ${recipient.fullName},`)}
        ${text(`<strong>${requester.fullName}</strong> has requested to cancel <strong>Session ${session.sessionNumber}</strong>. You have <strong>24 hours</strong> to approve or reject. If you don't respond, the cancellation will be approved automatically.`)}
        ${hr()}
        ${field('Reason', reason || 'No reason provided')}
        ${field('Response deadline', deadlineStr)}
        ${hr()}
        ${button(`${FRONTEND_URL}/therapist/bookings/${booking.id}`, 'Review Request')}
        ${muted('If you take no action within 24 hours, the session will be cancelled and the customer will receive a full refund for that session.')}
    `),
});

export const sessionCancellationApprovedToRequester = ({ requester, session, refundAmount, refundMethod }) => ({
    subject: `Session ${session.sessionNumber} cancellation approved`,
    html: layout(`
        ${heading('Session Cancellation Approved')}
        ${text(`Hi ${requester.fullName},`)}
        ${text(`Session ${session.sessionNumber} has been cancelled and a refund is on its way.`)}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#059669;font-size:13px;font-weight:600;text-align:center;margin:4px 0 0;">Refund for Session ${session.sessionNumber}</p>
        ${hr()}
        ${refundMethod === 'transferred'
            ? text('Your refund has been sent to your linked bank account and should arrive within 2–3 business days.')
            : `${text('To receive your refund, set up your payout account.')}${button(`${FRONTEND_URL}/customer/payout-setup`, 'Set Up Payout Account')}`
        }
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payment History')}
    `),
});

export const sessionCancellationRejectedToRequester = ({ requester, session, rejectionReason }) => ({
    subject: `Session ${session.sessionNumber} cancellation request declined`,
    html: layout(`
        ${heading('Session Cancellation Declined')}
        ${text(`Hi ${requester.fullName},`)}
        ${text(`Your request to cancel Session ${session.sessionNumber} was declined. The session remains active.`)}
        ${hr()}
        ${field('Reason', rejectionReason || 'No reason provided')}
        ${hr()}
        ${muted('If you have further questions, please contact the other party directly through the platform.')}
    `),
});

export const adminDirectMessage = ({ subject, message }) => ({
    subject,
    html: layout(`
        ${text(message.replace(/\n/g, '<br />'))}
        ${hr()}
        ${muted('This message was sent by the RehabTask admin team. Please do not reply to this email.')}
    `),
});

export const cancellationAutoApprovedToCustomer = ({ customer, therapist, booking, refundAmount, refundMethod }) => ({
    subject: 'Your cancellation has been automatically approved',
    html: layout(`
        ${heading('Cancellation Auto-Approved')}
        ${text(`Hi ${customer.fullName},`)}
        ${text(`Your therapist did not respond to your cancellation request within 24 hours. Your booking with <strong>${therapist.fullName}</strong> has been automatically cancelled.`)}
        ${hr()}
        <p style="color:#059669;font-size:32px;font-weight:700;text-align:center;margin:0;">${formatCurrency(refundAmount)}</p>
        <p style="color:#059669;font-size:13px;font-weight:600;text-align:center;margin:4px 0 0;">Full Refund</p>
        ${hr()}
        ${refundMethod === 'transferred'
            ? text('Your refund has been sent to your linked bank account and should arrive within 2–3 business days.')
            : `${text('To receive your refund, set up your payout account.')}${button(`${FRONTEND_URL}/customer/payout-setup`, 'Set Up Payout Account')}`
        }
        ${button(`${FRONTEND_URL}/customer/payments`, 'View Payment History')}
    `),
});