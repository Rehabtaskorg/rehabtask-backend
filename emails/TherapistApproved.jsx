import { Text, Heading } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const TherapistApproved = ({ therapist }) => {
    return (
        <EmailLayout preview="Your RehabTask profile has been approved!">
            <Heading style={heading}>Congratulations, {therapist.fullName}!</Heading>
            <Text style={text}>
                Great news — your RehabTask profile has been reviewed and <strong>approved</strong>.
                Your profile is now live and visible to customers looking for therapy services.
            </Text>
            <Text style={text}>
                To start receiving payments for your sessions, please complete your Stripe Connect
                setup. This only takes a few minutes and is required before you can accept bookings.
            </Text>
            <EmailButton href={`${frontendUrl}/therapist/onboarding`}>Set Up Payments</EmailButton>
            <Text style={muted}>
                If you have any questions about getting started, visit our Help Center or contact support.
            </Text>
        </EmailLayout>
    );
};

export default TherapistApproved;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const muted = { color: '#6b7280', fontSize: '13px', lineHeight: '20px', marginTop: '24px' };