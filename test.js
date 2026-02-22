/**
 * What Was Found in Your Codebase
Existing email infrastructure (partial):

src/config/email.js — Resend client exists, but crashes on startup if RESEND_API_KEY is missing
src/services/email.service.js — Empty stub (one comment line)
emails/*.jsx — 12 React Email template files that all exist but are completely empty
emails/NewMessageNotification.jsx — Does not exist, must be created
src/services/message.service.js — Has the email notification code commented out (lines 190–196) with an old inline HTML function at the bottom (lines 695–734) that needs replacing
src/jobs/sessionReminders.js and src/jobs/index.js — Both are stubs (one comment line each)
What the Prompt Covers
The plan file contains a copy-pasteable Claude web chat prompt with:

Files to attach — exact list of 24 files
nodemailer install — npm install nodemailer (not yet in package.json)
src/config/mailer.js (new) — nodemailer/Gmail active, full Resend block commented for easy production swap
src/config/env.js — Make RESEND_API_KEY optional + add GMAIL_USER, GMAIL_APP_PASSWORD
src/config/email.js — Remove the startup throw, guard Resend on null
src/services/email.service.js — All 13 dispatch functions using React.createElement() (safe for .js files without a build step)
Anti-spam strategy — Count existing unread messages in the conversation BEFORE inserting the new one. If count === 0 → send email. Zero extra DB tables, self-healing when user reads messages.
message.service.js — Anti-spam count, uncomment notification, delete old inline HTML function
offer.service.js — Expanded Prisma includes + notifications in createOffer and acceptOffer
session.service.js — Expanded Prisma includes + notifications in both session functions
sessionReminders.js + jobs/index.js — Full implementation
All 13 React Email templates — Detailed props + content spec for each
.env.example — Gmail vars added
Verification steps — How to test end-to-end
Claude’s Plan
Email Notification System — RehabTask Platform
Context
The platform needs to send email notifications to users for messaging and business events (new offers, session lifecycle, etc.). The codebase already has Resend configured but it's restricted to verified domains only, making it unusable during development. The goal is to:

Add a Gmail/nodemailer transport for development with Resend code alongside but commented out — ready to swap for production.
Implement the anti-spam "first-unread" strategy for message notifications.
Implement all 13 empty React Email templates.
Wire email dispatch into the correct services.
No changes have been made yet. The output of this plan is a complete, copy-pasteable prompt for Claude web chat to execute.

Existing State (verified by reading files)
File	Current State
src/config/email.js	Resend client. Throws on startup if RESEND_API_KEY missing (line 3–5). sendEmail() and sendBulkEmails() exist.
src/config/env.js	Zod validation. RESEND_API_KEY: z.string() (required). No Gmail vars.
src/config/logger.js	Winston logger — exports logger
src/services/email.service.js	Stub — single comment line only
src/services/notification.service.js	Empty stub
src/services/message.service.js	734 lines. Email notification commented out at lines 190–196. Old inline sendMessageEmailNotification() at lines 695–734 (inline HTML, direct Resend).
src/services/offer.service.js	createOffer() and acceptOffer() — no notifications.
src/services/session.service.js	completeSessionByTherapist() and confirmSessionByCustomer() — no notifications.
src/jobs/sessionReminders.js	Stub — one comment line
src/jobs/index.js	Stub — one comment line
emails/_components/EmailLayout.jsx	Exists. All style objects empty. No shared components.
emails/*.jsx (12 files)	All empty — TherapistRegistrationPending, TherapistApproved, TherapistRejected, SubscriptionActivated, NewRequestNotication (typo), NewOfferNotification, OfferAccepted, PaymentConfirmation, SessionReminder, SessionCompletionRequest, SessionConfirmed, PayoutConfirmation
emails/NewMessageNotification.jsx	Does NOT exist — must be created
nodemailer is NOT installed. Must be added to package.json.

Recommended Approach
Anti-spam: "First-unread" — count existing unread messages in the conversation context BEFORE inserting the new message. If count === 0, the user was caught up — send notification. If count > 0, they already have pending notifications. No extra DB table needed. Self-healing because markMessagesAsRead() resets readAt, naturally resetting the count.
Mailer: New src/config/mailer.js — nodemailer/Gmail active, Resend block present but fully commented.
email.service.js: All 13 dispatch functions. Uses React.createElement() (not JSX) since it's a .js file with no build step.
Fire-and-forget: All .catch() at call sites — email never breaks an API response.
Claude Web Chat Prompt
Copy everything below this line and paste into Claude web chat. Attach the files listed at the top of the prompt.


## Task: Implement Email Notification System for RehabTask Backend

### Files to attach (provide full file contents for each):
- src/config/email.js
- src/config/env.js
- src/config/logger.js
- src/services/email.service.js
- src/services/message.service.js
- src/services/offer.service.js
- src/services/session.service.js
- src/jobs/sessionReminders.js
- src/jobs/index.js
- emails/_components/EmailLayout.jsx
- emails/TherapistRegistrationPending.jsx
- emails/TherapistApproved.jsx
- emails/TherapistRejected.jsx
- emails/SubscriptionActivated.jsx
- emails/NewRequestNotication.jsx
- emails/NewOfferNotification.jsx
- emails/OfferAccepted.jsx
- emails/PaymentConfirmation.jsx
- emails/SessionReminder.jsx
- emails/SessionCompletionRequest.jsx
- emails/SessionConfirmed.jsx
- emails/PayoutConfirmation.jsx
- prisma/schema.prisma
- .env.example

---

### Project Context

This is an Express.js v5 REST API using ES modules (`"type": "module"` in package.json). No build step — no Babel, no Webpack. ORM is Prisma v7 with PostgreSQL. Email templates use `@react-email/components` and `@react-email/render`. Logger is Winston exported as `logger` from `src/config/logger.js`.

The app already has a Resend email client in `src/config/email.js`, but during development it cannot send to unverified addresses. The developer needs to use **Gmail via nodemailer** for development, with Resend code present but commented out so it can be uncommented for production deployment.

**nodemailer is not yet installed.** Add it to package.json dependencies (`npm install nodemailer`).

---

### Implementation Instructions

Make ALL of the following changes precisely. Do not skip any file. Do not add unnecessary abstractions. Approach this as a mid-level developer would — clean, pragmatic, production-aware.

---

#### 1. Install nodemailer

Add `"nodemailer": "^6.9.16"` to `dependencies` in `package.json`.

---

#### 2. Modify `src/config/env.js`

a) Make `RESEND_API_KEY` optional (it currently throws on startup when missing):
```js
// CHANGE from:
RESEND_API_KEY: z.string(),
// TO:
RESEND_API_KEY: z.string().optional(),
b) Add Gmail development mail vars after the existing email block:


// Email (Gmail — development transport)
GMAIL_USER: z.string().optional(),
GMAIL_APP_PASSWORD: z.string().optional(),
EMAIL_FROM_NAME: z.string().default('RehabTask'),
c) Add GMAIL_USER and GMAIL_APP_PASSWORD to the destructured exports at the bottom of the file.

3. Modify src/config/email.js
Remove the startup throw when RESEND_API_KEY is missing. Replace:


if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not defined in environment variables");
}
export const resend = new Resend(process.env.RESEND_API_KEY);
With a conditional init that silently skips Resend when key is absent (it will be absent in dev):


// Resend is the production email provider.
// In development, use src/config/mailer.js (nodemailer/Gmail) instead.
export const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
Guard both sendEmail and sendBulkEmails to early-return when resend is null:


export const sendEmail = async ({ to, subject, html, text, replyTo }) => {
    if (!resend) {
        console.warn('[email.js] Resend not configured — skipping email to', to);
        return { success: false, error: 'Resend not configured' };
    }
    // ... rest of existing function unchanged
};
Apply the same guard to sendBulkEmails.

4. Create src/config/mailer.js (new file)
This is the ACTIVE transport for the application. nodemailer/Gmail is the active code. The Resend block is present but fully commented — it should be a clear "uncomment this, comment that" swap for production.


/**
 * Application mail transport.
 *
 * DEVELOPMENT:  nodemailer + Gmail App Password (active below)
 * PRODUCTION:   Resend API (commented out below — swap when deploying)
 *
 * Gmail setup: https://myaccount.google.com/apppasswords (requires 2FA)
 */
import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import { env } from './env.js';

// ---------------------------------------------------------------------------
// ACTIVE: nodemailer + Gmail (development)
// ---------------------------------------------------------------------------

let transporter = null;

if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: env.GMAIL_USER,
            pass: env.GMAIL_APP_PASSWORD,
        },
    });
} else {
    logger.warn('[Mailer] GMAIL_USER or GMAIL_APP_PASSWORD not set — emails will be skipped in dev');
}

/**
 * Send a single email.
 * Returns { success, messageId?, error? } — never throws.
 */
export const sendMail = async ({ to, subject, html, text, replyTo }) => {
    if (!transporter) {
        logger.warn('[Mailer] No transport — skipping email', { to, subject });
        return { success: false, error: 'No mail transport configured' };
    }

    try {
        const info = await transporter.sendMail({
            from: `"${env.EMAIL_FROM_NAME || 'RehabTask'}" <${env.GMAIL_USER}>`,
            to,
            subject,
            html,
            ...(text && { text }),
            ...(replyTo && { replyTo }),
        });
        logger.info('[Mailer] Email sent', { to, subject, messageId: info.messageId });
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error('[Mailer] Send failed', { to, subject, error: error.message });
        return { success: false, error: error.message };
    }
};

// ---------------------------------------------------------------------------
// PRODUCTION SWITCH — when deploying:
//   1. Comment out the entire "ACTIVE: nodemailer" block above
//   2. Uncomment the entire block below
//   3. Ensure RESEND_API_KEY is set in production .env
// ---------------------------------------------------------------------------

// import { Resend } from 'resend';
// import { logger } from './logger.js';
// import { env } from './env.js';
//
// if (!env.RESEND_API_KEY) {
//     throw new Error('[Mailer] RESEND_API_KEY is required in production');
// }
//
// const resendClient = new Resend(env.RESEND_API_KEY);
//
// export const sendMail = async ({ to, subject, html, text, replyTo }) => {
//     try {
//         const response = await resendClient.emails.send({
//             from: env.EMAIL_FROM,
//             to, subject, html,
//             ...(text && { text }),
//             ...(replyTo && { replyTo }),
//         });
//         logger.info('[Mailer] Email sent via Resend', { to, subject, emailId: response.id });
//         return { success: true, messageId: response.id };
//     } catch (error) {
//         logger.error('[Mailer] Resend send failed', { to, subject, error: error.message });
//         return { success: false, error: error.message };
//     }
// };
5. Implement src / services / email.service.js(currently just a comment)
This file has 13 dispatch functions — one per notification event.It imports sendMail from mailer.js and renders React Email templates.Since this is a.js file(no JSX support without a build step), use React.createElement() instead of JSX syntax when calling render().


import React from 'react';
import { render } from '@react-email/render';
import { sendMail } from '../config/mailer.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

// Template imports
import TherapistRegistrationPending from '../../emails/TherapistRegistrationPending.jsx';
import TherapistApproved from '../../emails/TherapistApproved.jsx';
import TherapistRejected from '../../emails/TherapistRejected.jsx';
import SubscriptionActivated from '../../emails/SubscriptionActivated.jsx';
import NewRequestNotification from '../../emails/NewRequestNotication.jsx'; // filename typo preserved intentionally
import NewOfferNotification from '../../emails/NewOfferNotification.jsx';
import OfferAccepted from '../../emails/OfferAccepted.jsx';
import PaymentConfirmation from '../../emails/PaymentConfirmation.jsx';
import SessionReminder from '../../emails/SessionReminder.jsx';
import SessionCompletionRequest from '../../emails/SessionCompletionRequest.jsx';
import SessionConfirmed from '../../emails/SessionConfirmed.jsx';
import PayoutConfirmation from '../../emails/PayoutConfirmation.jsx';
import NewMessageNotification from '../../emails/NewMessageNotification.jsx';

// ---------------------------------------------------------------------------
// Internal helper — renders template and dispatches. Never throws.
// ---------------------------------------------------------------------------
const dispatch = async (to, subject, Component, props) => {
    try {
        const html = await render(React.createElement(Component, props));
        return await sendMail({ to, subject, html });
    } catch (error) {
        logger.error('[EmailService] Dispatch failed', { to, subject, error: error.message });
        return { success: false, error: error.message };
    }
};

// ---------------------------------------------------------------------------
// 1. Therapist submitted registration
//    - Notifies admin + sends acknowledgement to therapist
// ---------------------------------------------------------------------------
export const sendTherapistRegistrationPending = async ({ therapist }) => {
    // Admin notification
    dispatch(
        env.ADMIN_EMAIL,
        'New Therapist Registration — Review Required',
        TherapistRegistrationPending,
        { therapist, isAdmin: true }
    ).catch(() => { });

    // Therapist acknowledgement
    return dispatch(
        therapist.user.email,
        'Your RehabTask application has been received',
        TherapistRegistrationPending,
        { therapist, isAdmin: false }
    );
};

// ---------------------------------------------------------------------------
// 2. Admin approved therapist
// ---------------------------------------------------------------------------
export const sendTherapistApproved = async ({ therapist }) => {
    return dispatch(
        therapist.user.email,
        'Congratulations — Your RehabTask profile is approved',
        TherapistApproved,
        { therapist }
    );
};

// ---------------------------------------------------------------------------
// 3. Admin rejected therapist
// ---------------------------------------------------------------------------
export const sendTherapistRejected = async ({ therapist, reason }) => {
    return dispatch(
        therapist.user.email,
        'Update on your RehabTask application',
        TherapistRejected,
        { therapist, reason }
    );
};

// ---------------------------------------------------------------------------
// 4. Subscription activated (customer)
// ---------------------------------------------------------------------------
export const sendSubscriptionActivated = async ({ customer, subscription }) => {
    return dispatch(
        customer.user.email,
        'Your RehabTask subscription is active',
        SubscriptionActivated,
        { customer, subscription }
    );
};

// ---------------------------------------------------------------------------
// 5. New therapy request — notify matching therapists (bulk, fire-and-forget)
// ---------------------------------------------------------------------------
export const sendNewRequestNotifications = async ({ therapists, request, customer }) => {
    return Promise.allSettled(
        therapists.map((therapist) =>
            dispatch(
                therapist.user.email,
                'New therapy request in your area',
                NewRequestNotification,
                { therapist, request, customer }
            )
        )
    );
};

// ---------------------------------------------------------------------------
// 6. Therapist submitted offer — notify customer
// ---------------------------------------------------------------------------
export const sendNewOfferNotification = async ({ customer, therapist, offer, request }) => {
    return dispatch(
        customer.user.email,
        `${therapist.fullName} sent you a therapy offer`,
        NewOfferNotification,
        { customer, therapist, offer, request }
    );
};

// ---------------------------------------------------------------------------
// 7. Customer accepted offer — notify therapist (booking confirmed)
// ---------------------------------------------------------------------------
export const sendOfferAccepted = async ({ therapist, customer, booking, offer }) => {
    return dispatch(
        therapist.user.email,
        'Your offer has been accepted — booking confirmed',
        OfferAccepted,
        { therapist, customer, booking, offer }
    );
};

// ---------------------------------------------------------------------------
// 8. Payment captured — customer receipt
// ---------------------------------------------------------------------------
export const sendPaymentConfirmation = async ({ customer, booking, payment }) => {
    return dispatch(
        customer.user.email,
        'Payment confirmed — RehabTask receipt',
        PaymentConfirmation,
        { customer, booking, payment }
    );
};

// ---------------------------------------------------------------------------
// 9. Session reminder — 24h before, sent to both parties
// ---------------------------------------------------------------------------
export const sendSessionReminder = async ({ customer, therapist, booking }) => {
    dispatch(
        customer.user.email,
        'Reminder: Your therapy session is tomorrow',
        SessionReminder,
        { recipient: customer, booking, role: 'customer' }
    ).catch(() => { });

    return dispatch(
        therapist.user.email,
        `Reminder: Session with ${customer.fullName} is tomorrow`,
        SessionReminder,
        { recipient: therapist, booking, role: 'therapist' }
    );
};

// ---------------------------------------------------------------------------
// 10. Therapist marked session complete — ask customer to confirm
// ---------------------------------------------------------------------------
export const sendSessionCompletionRequest = async ({ customer, therapist, session, booking }) => {
    return dispatch(
        customer.user.email,
        `${therapist.fullName} marked your session as complete — please confirm`,
        SessionCompletionRequest,
        { customer, therapist, session, booking }
    );
};

// ---------------------------------------------------------------------------
// 11. Customer confirmed session — notify therapist (payout in progress)
// ---------------------------------------------------------------------------
export const sendSessionConfirmed = async ({ therapist, customer, session, booking }) => {
    return dispatch(
        therapist.user.email,
        'Session confirmed by customer — payout in progress',
        SessionConfirmed,
        { therapist, customer, session, booking }
    );
};

// ---------------------------------------------------------------------------
// 12. Payout sent to therapist Stripe account
// ---------------------------------------------------------------------------
export const sendPayoutConfirmation = async ({ therapist, payment, booking }) => {
    return dispatch(
        therapist.user.email,
        'Your payout has been sent',
        PayoutConfirmation,
        { therapist, payment, booking }
    );
};

// ---------------------------------------------------------------------------
// 13. New message notification (anti-spam: first-unread-only, see message.service.js)
// ---------------------------------------------------------------------------
export const sendNewMessageNotification = async ({ recipient, senderName, message, contextType, contextId }) => {
    return dispatch(
        recipient.email,
        `New message from ${senderName}`,
        NewMessageNotification,
        { recipient, senderName, message, contextType, contextId, frontendUrl: env.FRONTEND_URL }
    );
};
6. Modify src / services / message.service.js
a) Add imports at the top(alongside existing imports):


import { sendNewMessageNotification } from './email.service.js';
import { logger } from '../config/logger.js';
b) Anti - spam check + uncomment email notification

In createMessage(), BEFORE the prisma.message.create() call, add:


// Anti-spam: only notify on the first unread in this conversation.
// If the recipient already has unread messages here, they're aware.
const existingUnreadCount = await prisma.message.count({
    where: {
        [contextType === 'offer' ? 'offerId' : 'bookingId']: contextId,
        recipientId,
        readAt: null,
    },
});
const shouldEmailNotify = existingUnreadCount === 0;
Then AFTER publishMessageToRealtime(message, contextType, contextId), replace the existing commented block(lines ~190–196) with:


const isRecipientOnline = await checkUserOnlineStatus(recipientId);

if (!isRecipientOnline && shouldEmailNotify) {
    const senderName =
        message.sender.therapistProfile?.fullName ||
        message.sender.customerProfile?.fullName ||
        'A user';

    sendNewMessageNotification({
        recipient: message.recipient,
        senderName,
        message,
        contextType,
        contextId,
    }).catch((err) => {
        logger.error('[MessageService] Email notification failed', { error: err.message });
    });
}
c) Delete the old inline sendMessageEmailNotification function at lines ~695–734. It is fully replaced by the email service.

7. Modify src / services / offer.service.js
a) Add imports at the top:


import { sendNewOfferNotification, sendOfferAccepted } from './email.service.js';
import { logger } from '../config/logger.js';
b) In createOffer() — expand the Prisma include and add notification

Change the prisma.offer.create() include from:


include: {
    therapist: true
},
To:


include: {
    therapist: true,
        request: {
        include: {
            customer: {
                include: { user: { select: { id: true, email: true } } }
            },
        },
    },
},
After the prisma.therapyRequest.update() call, add(fire - and - forget):


sendNewOfferNotification({
    customer: offer.request.customer,
    therapist: offer.therapist,
    offer,
    request: offer.request,
}).catch((err) => {
    logger.error('[OfferService] New offer notification failed', { error: err.message });
});
c) In acceptOffer() — expand the booking include and add notification

Change the prisma.booking.create() include from:


include: {
    therapist: true,
        customer: true,
            offer: {
        include: { request: true }
    },
},
To:


include: {
    therapist: {
        include: { user: { select: { id: true, email: true } } }
    },
    customer: {
        include: { user: { select: { id: true, email: true } } }
    },
    offer: {
        include: { request: true }
    },
},
After building booking, before the return { offer: updatedOffer, booking }, add:


sendOfferAccepted({
    therapist: booking.therapist,
    customer: booking.customer,
    booking,
    offer: booking.offer,
}).catch((err) => {
    logger.error('[OfferService] Offer accepted notification failed', { error: err.message });
});
8. Modify src / services / session.service.js
a) Add imports at the top:


import { sendSessionCompletionRequest, sendSessionConfirmed } from './email.service.js';
import { logger } from '../config/logger.js';
b) In completeSessionByTherapist() — expand include and add notification

Change the prisma.session.findUnique() include from:


include: { booking: true }
To:


include: {
    booking: {
        include: {
            customer: {
                include: { user: { select: { id: true, email: true } } }
            },
            therapist: true,
        },
    },
},
After the prisma.booking.update() call, add:


sendSessionCompletionRequest({
    customer: session.booking.customer,
    therapist: session.booking.therapist,
    session: updatedSession,
    booking: session.booking,
}).catch((err) => {
    logger.error('[SessionService] Completion request notification failed', { error: err.message });
});
c) In confirmSessionByCustomer() — expand include and add notification

Expand the session include similarly:


include: {
    booking: {
        include: {
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
            customer: true,
        },
    },
},
After the prisma.booking.update() call, add:


sendSessionConfirmed({
    therapist: session.booking.therapist,
    customer: session.booking.customer,
    session: updatedSession,
    booking: session.booking,
}).catch((err) => {
    logger.error('[SessionService] Session confirmed notification failed', { error: err.message });
});
9. Implement src / jobs / sessionReminders.js
Replace the stub with a full implementation.The job queries sessions scheduled in the next 23–25 hour window(safe overlap to avoid missing any in hourly runs):


import { prisma } from '../config/prisma.js';
import { sendSessionReminder } from '../services/email.service.js';
import { logger } from '../config/logger.js';

/**
 * Send 24-hour session reminders.
 * Queries sessions in a 23-25 hour window to safely cover hourly runs.
 */
export const runSessionReminders = async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // IMPORTANT: scheduledDate lives on Booking, not Session.
    // Query bookings with confirmed/active sessions in the window.
    const bookings = await prisma.booking.findMany({
        where: {
            scheduledDate: {
                gte: windowStart,
                lte: windowEnd,
            },
            status: { in: ['confirmed', 'pending'] },
        },
        include: {
            customer: {
                include: { user: { select: { id: true, email: true } } }
            },
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
        },
    });

    logger.info(`[SessionReminders] Found ${bookings.length} upcoming sessions`);

    const results = await Promise.allSettled(
        bookings.map((booking) =>
            sendSessionReminder({ customer: booking.customer, therapist: booking.therapist, booking })
        )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    logger.info(`[SessionReminders] Reminders sent: ${bookings.length - failed}, failed: ${failed}`);
};
Also implement src / jobs / index.js to schedule the job using node-cron(or note if node - cron is not installed and it should use setInterval with date - fns — check package.json for node - cron).If node - cron is NOT installed, use a simple setInterval approach.If it IS installed, use cron syntax '0 * * * *'(every hour).

10. Modify emails / _components / EmailLayout.jsx
Fill in the empty style objects and add a reusable EmailButton component:


import { Body, Container, Head, Html, Text, Preview, Link, Button } from "@react-email/components";

export const EmailLayout = ({ children, preview }) => {
    return (
        <Html>
            <Head />
            {preview && <Preview>{preview}</Preview>}
            <Body style={main}>
                <Container style={container}>
                    {children}
                    <Text style={footer}>
                        RehabTask — Steadfast Rehabilitation Services
                        <br />
                        <Link href={`${process.env.FRONTEND_URL}/help`} style={footerLink}>Help Center</Link>
                        {' · '}
                        <Link href={`${process.env.FRONTEND_URL}/contact`} style={footerLink}>Contact Us</Link>
                        {' · '}
                        <Link href={`${process.env.FRONTEND_URL}/privacy`} style={footerLink}>Privacy Policy</Link>
                    </Text>
                </Container>
            </Body>
        </Html>
    );
};

export const EmailButton = ({ href, children }) => (
    <Button href={href} style={button}>
        {children}
    </Button>
);

export default EmailLayout;

// ---- Shared Styles ----
const main = {
    backgroundColor: '#f6f9fc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif',
};

const container = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '40px 32px',
    maxWidth: '600px',
    borderRadius: '8px',
};

const footer = {
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '18px',
    marginTop: '40px',
    borderTop: '1px solid #e6ebf1',
    paddingTop: '20px',
    textAlign: 'center',
};

const footerLink = {
    color: '#8898aa',
};

const button = {
    backgroundColor: '#2563EB',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: '600',
    padding: '12px 24px',
    textDecoration: 'none',
};
11. Implement all 13 React Email Templates
For every template below, produce complete JSX.Use EmailLayout and EmailButton from _components / EmailLayout.jsx.All monetary amounts should be formatted with Number(amount).toFixed(2) since Prisma returns Decimal objects.Dates formatted with new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).

Brand colours: primary blue #2563EB, text #1a1a1a, muted #6b7280, success green #16a34a.

    emails / TherapistRegistrationPending.jsx

Props: { therapist: { fullName, primaryLicenseType, licenseState, user: { email } }, isAdmin: boolean }

isAdmin: true → Subject: "New Therapist Registration — Review Required".Show therapist name, license type + state, their email.CTA: "Review Application" → { FRONTEND_URL } /admin/therapists.
    isAdmin: false → Subject: "Your application has been received".Thank the therapist.Tell them review takes 2–5 business days.CTA: "Complete Your Profile" → { FRONTEND_URL } /therapist/onboarding.
        emails / TherapistApproved.jsx

Props: { therapist: { fullName, user: { email } } }

Warm congratulations.Tell them their profile is now live.Remind them to complete Stripe Connect to receive payments.CTA: "Set Up Payments" → { FRONTEND_URL } /therapist/onboarding.

    emails / TherapistRejected.jsx

Props: { therapist: { fullName, user: { email } }, reason: string }

Empathetic tone.Display reason in a highlighted callout box(background #fef2f2, border left 4px solid #ef4444).Invite them to contact support with questions.CTA: "Contact Support" → { FRONTEND_URL }/contact.

emails / SubscriptionActivated.jsx

Props: { customer: { fullName, user: { email } }, subscription: { planType, currentPeriodEnd } }

Confirm subscription is active.Show plan name and renewal date.CTA: "Post a Request" → { FRONTEND_URL } /requests/new.

    emails / NewRequestNotication.jsx(preserve filename typo)

Props: { therapist: { fullName }, request: { serviceType, description, location, preferredDate }, customer: { fullName } }

Alert therapist to a new request matching their area.Show service type, location, proposed date, description truncated to 150 chars.CTA: "View Request" → { FRONTEND_URL }/requests.

emails / NewOfferNotification.jsx

Props: { customer: { fullName }, therapist: { fullName }, offer: { rate, sessionType, proposedDate, description, expiresAt }, request: { serviceType } }

Inform customer they received an offer.Show therapist name prominently.Rate in large text.Proposed date and session type.Description.Expiry warning: "This offer expires on {date}".CTA: "Review Offer" → { FRONTEND_URL }/requests.

emails / OfferAccepted.jsx

Props: { therapist: { fullName }, customer: { fullName }, booking: { scheduledDate, rate, sessionType, id }, offer: { id } }

Congratulate therapist.Show customer name, session date, rate, session type.Remind them to prepare.CTA: "View Booking" → { FRONTEND_URL } /therapist/bookings.

    emails / PaymentConfirmation.jsx

Props: { customer: { fullName }, booking: { scheduledDate, sessionType, rate, therapist: { fullName } }, payment: { amount, stripePaymentIntentId, createdAt } }

Payment receipt.Show amount prominently.Itemize: therapist name, session date, session type.Transaction ID in small muted text at the bottom.CTA: "View Booking" → { FRONTEND_URL } /bookings/{ booking.id }.

emails / SessionReminder.jsx

Props: { recipient: { fullName }, booking: { scheduledDate, sessionType, rate, id, customer ?: { fullName }, therapist ?: { fullName } }, role: 'customer' | 'therapist' }

24 - hour reminder.Customer: "Your session is tomorrow with [therapist name]".Therapist: "You have a session tomorrow with [customer name]".Show date / time and session type.CTA: "View Details" → { FRONTEND_URL } /bookings/{ booking.id }.

emails / SessionCompletionRequest.jsx

Props: { customer: { fullName }, therapist: { fullName }, session: { completedAt }, booking: { rate, sessionType, id } }

Ask customer to confirm the session.Show therapist name, session type, rate, completion date.Note: "If not confirmed within 72 hours, the session will be auto-confirmed." CTA: "Confirm Session" → { FRONTEND_URL } /bookings/{ booking.id }.

emails / SessionConfirmed.jsx

Props: { therapist: { fullName }, customer: { fullName }, booking: { rate, sessionType, scheduledDate, id } }

Tell therapist customer confirmed.Show earnings amount(rate minus platform fee — note: exact net payout depends on fee %, just show gross rate with a note).CTA: "View Earnings" → { FRONTEND_URL } /therapist/earnings.

    emails / PayoutConfirmation.jsx

Props: { therapist: { fullName }, payment: { therapistPayout, releasedAt, stripeTransferId }, booking: { sessionType, scheduledDate } }

Confirm payout was sent.Show net payout amount prominently in green.Session type and date.Stripe transfer ID in muted small text.Note: "Funds typically arrive within 2–3 business days." CTA: "View Earnings" → { FRONTEND_URL } /therapist/earnings.

    emails / NewMessageNotification.jsx(NEW FILE — does not exist yet, create it)

Props: { recipient: { email }, senderName: string, message: { content, patientId ? }, contextType: 'offer' | 'booking', contextId: string, frontendUrl: string }

Clean, minimal layout. "You have a new message from [senderName]".Message preview — truncate content to 200 chars, append "..." if truncated.If message.patientId is truthy, add a muted line "Regarding patient: [patient not included in this notification — view in app]"(no patient data passed to avoid over - fetching).CTA: "Reply to Message" → { frontendUrl } /messages/{ contextType }/{contextId}. Footer note: "You received this because you had no unread messages in this conversation."

12. Update.env.example
Add the Gmail vars and mark RESEND_API_KEY as optional:


# Email — Development(Gmail / nodemailer)
GMAIL_USER = your_gmail@gmail.com
GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx
EMAIL_FROM_NAME = RehabTask

# Email — Production(Resend — uncomment mailer.js block when deploying)
# RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM = RehabTask < noreply@rehabtask.com>
    ADMIN_EMAIL=admin @rehabtask.com
Verification Steps
After implementation, verify with these checks:

Server starts without RESEND_API_KEY → should log a warning, not throw.
Message test: POST a message to an offer conversation.Check logs for [Mailer] Email sent.Send a second message immediately — no second email should be sent(unread count > 0).
Read and re - notify test: Call markMessagesAsRead, then send a new message — email should fire again.
Offer creation: Create an offer as a therapist → customer should receive NewOfferNotification email.
Offer accept: Accept an offer as a customer → therapist should receive OfferAccepted email.
Session completion: Mark session complete as therapist → customer should receive SessionCompletionRequest email.
Inspect template HTML: Call render(React.createElement(NewMessageNotification, { ...})) directly in a test script and console.log the HTML to verify template renders correctly.
Constraints and Notes
All files use ES module syntax (import/export) — no require().
Do NOT use JSX syntax in .js files.Use React.createElement(Component, props) when calling render() from email.service.js.
All email dispatches from service files are fire - and - forget(.catch () at call site) — email errors must NEVER propagate to HTTP responses.
Preserve the filename typo NewRequestNotication.jsx — it's an existing file.
CustomerProfile and TherapistProfile do NOT have an email field.Always navigate profile.user.email.Include user: { select: { id: true, email: true } } wherever email is needed in Prisma queries.
Monetary values from Prisma are Decimal objects — always call Number(value).toFixed(2) in templates.
Do not install any packages other than nodemailer.Everything else is already in package.json.
Do not modify prisma / schema.prisma — the anti - spam approach requires no schema changes.


---

## Verification Plan

1. Start server → no `RESEND_API_KEY` error.
2. Send a message via API → check Winston logs for `[Mailer] Email sent`.
3. Send a 2nd message immediately → no email log(first - unread check works).
4. Mark messages read via `markMessagesAsRead` endpoint → send new message → email fires again.
5. Create offer as therapist → verify `NewOfferNotification` email reaches Gmail inbox.
6. Manually render a template in a scratch script to validate HTML output.
