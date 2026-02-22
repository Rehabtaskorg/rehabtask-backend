import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const SubscriptionActivated = ({ customer, subscription }) => {
    const renewalDate = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    return (
        <EmailLayout preview="Your RehabTask subscription is now active">
            <Heading style={heading}>Subscription Active</Heading>
            <Text style={text}>Hi {customer.fullName},</Text>
            <Text style={text}>
                Your RehabTask subscription is now active. You can start posting therapy requests
                and connecting with qualified therapists right away.
            </Text>
            <Hr style={hr} />
            <Text style={label}>Plan</Text>
            <Text style={value}>{subscription.planType.charAt(0).toUpperCase() + subscription.planType.slice(1)}</Text>
            <Text style={label}>Renewal Date</Text>
            <Text style={value}>{renewalDate}</Text>
            <Hr style={hr} />
            <EmailButton href={`${frontendUrl}/requests/new`}>Post a Request</EmailButton>
        </EmailLayout>
    );
};

export default SubscriptionActivated;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };