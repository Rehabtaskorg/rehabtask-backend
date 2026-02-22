import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const SessionReminder = ({ recipient, booking, role }) => {
    const sessionDate = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    const sessionTime = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';

    const otherPartyName = role === 'customer'
        ? booking.therapist?.fullName || 'your therapist'
        : booking.customer?.fullName || 'your customer';

    return (
        <EmailLayout preview="Reminder: Your therapy session is tomorrow">
            <Heading style={heading}>Session Reminder</Heading>
            <Text style={text}>Hi {recipient.fullName},</Text>
            <Text style={text}>
                {role === 'customer'
                    ? `This is a reminder that your session with ${otherPartyName} is scheduled for tomorrow.`
                    : `You have a session tomorrow with ${otherPartyName}.`
                }
            </Text>
            <Hr style={hr} />
            <Text style={label}>Date</Text>
            <Text style={value}>{sessionDate}</Text>
            {sessionTime && (
                <>
                    <Text style={label}>Time</Text>
                    <Text style={value}>{sessionTime}</Text>
                </>
            )}
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Hr style={hr} />
            <EmailButton href={`${frontendUrl}/bookings/${booking.id}`}>View Details</EmailButton>
        </EmailLayout>
    );
};

export default SessionReminder;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };