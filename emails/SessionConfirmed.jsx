import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const SessionConfirmed = ({ therapist, customer, session, booking }) => {
    return (
        <EmailLayout preview="Session confirmed by customer — payout in progress">
            <Heading style={heading}>Session Confirmed</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>
                <strong>{customer.fullName}</strong> has confirmed the session. Your payout is now being processed.
            </Text>
            <Hr style={hr} />
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Text style={label}>Gross Rate</Text>
            <Text style={value}>${Number(booking.rate).toFixed(2)}</Text>
            <Hr style={hr} />
            <Text style={muted}>
                The final payout amount will reflect the platform fee deduction. You'll receive a
                separate confirmation once the payout has been sent to your Stripe account.
            </Text>
            <EmailButton href={`${frontendUrl}/therapist/earnings`}>View Earnings</EmailButton>
        </EmailLayout>
    );
};

export default SessionConfirmed;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const muted = { color: '#6b7280', fontSize: '13px', lineHeight: '20px' };