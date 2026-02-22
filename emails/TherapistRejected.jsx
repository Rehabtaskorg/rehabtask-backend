import { Text, Heading } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const TherapistRejected = ({ therapist, reason }) => {
    return (
        <EmailLayout preview="Update on your RehabTask application">
            <Heading style={heading}>Application Update</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>
                Thank you for your interest in joining RehabTask. After reviewing your application,
                we're unable to approve your profile at this time.
            </Text>
            {reason && (
                <div style={callout}>
                    <Text style={calloutLabel}>Reason</Text>
                    <Text style={calloutText}>{reason}</Text>
                </div>
            )}
            <Text style={text}>
                If you believe this was made in error or have questions, please don't hesitate
                to reach out to our support team. We're happy to help.
            </Text>
            <EmailButton href={`${frontendUrl}/contact`}>Contact Support</EmailButton>
        </EmailLayout>
    );
};

export default TherapistRejected;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const callout = { backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', padding: '16px', borderRadius: '4px', margin: '20px 0' };
const calloutLabel = { color: '#991b1b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px', marginTop: '0' };
const calloutText = { color: '#1a1a1a', fontSize: '14px', lineHeight: '22px', margin: '0' };