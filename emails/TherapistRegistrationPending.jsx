import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const TherapistRegistrationPending = ({ therapist, isAdmin }) => {
    if (isAdmin) {
        return (
            <EmailLayout preview="New therapist registration requires review">
                <Heading style={heading}>New Therapist Registration</Heading>
                <Text style={text}>A new therapist has submitted a registration and is awaiting your review.</Text>
                <Hr style={hr} />
                <Text style={label}>Name</Text>
                <Text style={value}>{therapist.fullName}</Text>
                <Text style={label}>License Type</Text>
                <Text style={value}>{therapist.primaryLicenseType || 'Not provided'}</Text>
                <Text style={label}>License State</Text>
                <Text style={value}>{therapist.licenseState || 'Not provided'}</Text>
                <Text style={label}>Email</Text>
                <Text style={value}>{therapist.user.email}</Text>
                <Hr style={hr} />
                <EmailButton href={`${frontendUrl}/admin/therapists`}>Review Application</EmailButton>
            </EmailLayout>
        );
    }

    return (
        <EmailLayout preview="Your RehabTask application has been received">
            <Heading style={heading}>Application Received</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>
                Thank you for applying to join RehabTask. We've received your registration
                and our team is reviewing your application.
            </Text>
            <Text style={text}>
                This process typically takes <strong>2–5 business days</strong>. We'll email you
                as soon as a decision has been made.
            </Text>
            <Text style={text}>
                In the meantime, you can continue completing your profile to speed up the process.
            </Text>
            <EmailButton href={`${frontendUrl}/therapist/onboarding`}>Complete Your Profile</EmailButton>
        </EmailLayout>
    );
};

export default TherapistRegistrationPending;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };