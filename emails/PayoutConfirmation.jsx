import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const PayoutConfirmation = ({ therapist, payment, booking }) => {
    const sessionDate = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    return (
        <EmailLayout preview="Your payout has been sent">
            <Heading style={heading}>Payout Sent</Heading>
            <Text style={text}>Hi {therapist.fullName},</Text>
            <Text style={text}>Your payout has been processed and sent to your connected Stripe account.</Text>
            <Hr style={hr} />
            <Text style={payoutAmount}>${Number(payment.therapistPayout).toFixed(2)}</Text>
            <Text style={payoutLabel}>Net Payout</Text>
            <Hr style={hr} />
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Text style={label}>Session Date</Text>
            <Text style={value}>{sessionDate}</Text>
            <Hr style={hr} />
            <Text style={text}>Funds typically arrive within 2–3 business days.</Text>
            <EmailButton href={`${frontendUrl}/therapist/earnings`}>View Earnings</EmailButton>
            {payment.stripeTransferId && (
                <Text style={transactionId}>Transfer ID: {payment.stripeTransferId}</Text>
            )}
        </EmailLayout>
    );
};

export default PayoutConfirmation;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const payoutAmount = { color: '#16a34a', fontSize: '32px', fontWeight: '700', textAlign: 'center', margin: '0' };
const payoutLabel = { color: '#6b7280', fontSize: '13px', textAlign: 'center', marginTop: '4px' };
const transactionId = { color: '#8898aa', fontSize: '11px', textAlign: 'center', marginTop: '24px' };