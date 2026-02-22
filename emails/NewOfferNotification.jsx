import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const NewOfferNotification = ({ customer, therapist, offer, request }) => {
    const proposedDate = offer.proposedDate
        ? new Date(offer.proposedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'To be scheduled';

    const expiryDate = offer.expiresAt
        ? new Date(offer.expiresAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    return (
        <EmailLayout preview={`${therapist.fullName} sent you a therapy offer`}>
            <Heading style={heading}>You Received an Offer</Heading>
            <Text style={text}>Hi {customer.fullName},</Text>
            <Text style={text}>
                <strong>{therapist.fullName}</strong> has submitted an offer for your therapy request.
            </Text>
            <Hr style={hr} />
            <Text style={rateText}>${Number(offer.rate).toFixed(2)}</Text>
            <Text style={rateLabel}>per session</Text>
            <Hr style={hr} />
            <Text style={label}>Session Type</Text>
            <Text style={value}>{offer.sessionType}</Text>
            <Text style={label}>Proposed Date</Text>
            <Text style={value}>{proposedDate}</Text>
            {offer.description && (
                <>
                    <Text style={label}>Details</Text>
                    <Text style={value}>{offer.description}</Text>
                </>
            )}
            {expiryDate && (
                <Text style={warning}>This offer expires on {expiryDate}.</Text>
            )}
            <EmailButton href={`${frontendUrl}/requests`}>Review Offer</EmailButton>
        </EmailLayout>
    );
};

export default NewOfferNotification;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const rateText = { color: '#2563EB', fontSize: '32px', fontWeight: '700', textAlign: 'center', margin: '0' };
const rateLabel = { color: '#6b7280', fontSize: '13px', textAlign: 'center', marginTop: '4px' };
const warning = { color: '#b45309', fontSize: '13px', fontWeight: '500', backgroundColor: '#fffbeb', padding: '10px 14px', borderRadius: '4px', border: '1px solid #fde68a' };