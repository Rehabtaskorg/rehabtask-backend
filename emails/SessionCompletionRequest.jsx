import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const SessionCompletionRequest = ({ customer, therapist, session, booking }) => {
    const completedDate = session.completedAt
        ? new Date(session.completedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    return (
        <EmailLayout preview={`${therapist.fullName} marked your session as complete`}>
            <Heading style={heading}>Please Confirm Your Session</Heading>
            <Text style={text}>Hi {customer.fullName},</Text>
            <Text style={text}>
                <strong>{therapist.fullName}</strong> has marked your therapy session as complete.
                Please confirm that the session took place so we can process the therapist's payment.
            </Text>
            <Hr style={hr} />
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Text style={label}>Rate</Text>
            <Text style={value}>${Number(booking.rate).toFixed(2)}</Text>
            <Text style={label}>Completed</Text>
            <Text style={value}>{completedDate}</Text>
            <Hr style={hr} />
            <EmailButton href={`${frontendUrl}/bookings/${booking.id}`}>Confirm Session</EmailButton>
            <Text style={muted}>
                If not confirmed within 72 hours, the session will be auto-confirmed.
            </Text>
        </EmailLayout>
    );
};

export default SessionCompletionRequest;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const muted = { color: '#6b7280', fontSize: '12px', textAlign: 'center', marginTop: '20px' };