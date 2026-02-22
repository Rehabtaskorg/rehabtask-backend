import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const NewRequestNotification = ({ therapist, request, customer }) => {
    const preferredDate = request.preferredDate
        ? new Date(request.preferredDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'Flexible';

    const truncatedDesc = request.description && request.description.length > 150
        ? request.description.slice(0, 150) + '...'
        : request.description;

    return (
        <EmailLayout preview={`New therapy request: ${request.serviceType}`}>
            <Heading style={heading}>New Therapy Request</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>
                A new therapy request matching your area has been posted. Review the details below
                and submit an offer if you're interested.
            </Text>
            <Hr style={hr} />
            <Text style={label}>Service Type</Text>
            <Text style={value}>{request.serviceType}</Text>
            <Text style={label}>Location</Text>
            <Text style={value}>{request.location}</Text>
            <Text style={label}>Preferred Date</Text>
            <Text style={value}>{preferredDate}</Text>
            {truncatedDesc && (
                <>
                    <Text style={label}>Description</Text>
                    <Text style={value}>{truncatedDesc}</Text>
                </>
            )}
            <Hr style={hr} />
            <EmailButton href={`${frontendUrl}/requests`}>View Request</EmailButton>
        </EmailLayout>
    );
};

export default NewRequestNotification;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };