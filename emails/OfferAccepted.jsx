import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const OfferAccepted = ({ therapist, customer, booking, offer }) => {
    const sessionDate = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'To be confirmed';

    return (
        <EmailLayout preview="Your offer has been accepted — booking confirmed">
            <Heading style={heading}>Offer Accepted!</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>
                Great news — <strong>{customer.fullName}</strong> has accepted your offer and a booking
                has been confirmed.
            </Text>
            <Hr style={hr} />
            <Text style={label}>Customer</Text>
            <Text style={value}>{customer.fullName}</Text>
            <Text style={label}>Session Date</Text>
            <Text style={value}>{sessionDate}</Text>
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Text style={label}>Rate</Text>
            <Text style={value}>${Number(booking.rate).toFixed(2)}</Text>
            <Hr style={hr} />
            <Text style={text}>
                Please make sure to prepare for the session and review the booking details.
            </Text>
            <EmailButton href={`${frontendUrl}/therapist/bookings`}>View Booking</EmailButton>
        </EmailLayout>
    );
};

export default OfferAccepted;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };