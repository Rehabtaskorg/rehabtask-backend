import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

export const PaymentConfirmation = ({ customer, booking, payment }) => {
    const sessionDate = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    const paymentDate = payment.createdAt
        ? new Date(payment.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A';

    return (
        <EmailLayout preview="Payment confirmed — RehabTask receipt">
            <Heading style={heading}>Payment Confirmed</Heading>
            <Text style={text}>Hi {customer.fullName},</Text>
            <Text style={text}>Your payment has been successfully processed.</Text>
            <Hr style={hr} />
            <Text style={amountText}>${Number(payment.amount).toFixed(2)}</Text>
            <Text style={amountLabel}>Amount Paid</Text>
            <Hr style={hr} />
            <Text style={label}>Therapist</Text>
            <Text style={value}>{booking.therapist?.fullName || 'N/A'}</Text>
            <Text style={label}>Session Date</Text>
            <Text style={value}>{sessionDate}</Text>
            <Text style={label}>Session Type</Text>
            <Text style={value}>{booking.sessionType}</Text>
            <Text style={label}>Payment Date</Text>
            <Text style={value}>{paymentDate}</Text>
            <Hr style={hr} />
            <EmailButton href={`${frontendUrl}/bookings/${booking.id}`}>View Booking</EmailButton>
            {payment.stripePaymentIntentId && (
                <Text style={transactionId}>Transaction ID: {payment.stripePaymentIntentId}</Text>
            )}
        </EmailLayout>
    );
};

export default PaymentConfirmation;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const label = { color: '#6b7280', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' };
const value = { color: '#1a1a1a', fontSize: '14px', marginTop: '0', marginBottom: '16px' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const amountText = { color: '#16a34a', fontSize: '32px', fontWeight: '700', textAlign: 'center', margin: '0' };
const amountLabel = { color: '#6b7280', fontSize: '13px', textAlign: 'center', marginTop: '4px' };
const transactionId = { color: '#8898aa', fontSize: '11px', textAlign: 'center', marginTop: '24px' };