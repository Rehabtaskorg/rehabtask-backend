import { Text, Heading, Hr } from "@react-email/components";
import { EmailLayout, EmailButton } from "./_components/EmailLayout.jsx";

export const NewMessageNotification = ({ recipient, senderName, message, contextType, contextId, frontendUrl }) => {
    const baseUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

    const truncatedContent = message.content && message.content.length > 200
        ? message.content.slice(0, 200) + '...'
        : message.content;

    return (
        <EmailLayout preview={`New message from ${senderName}`}>
            <Heading style={heading}>New Message</Heading>
            <Text style={text}>You have a new message from <strong>{senderName}</strong>.</Text>
            <div style={messagePreview}>
                <Text style={messageText}>{truncatedContent}</Text>
            </div>
            {message.patientId && (
                <Text style={muted}>
                    Regarding a patient — view the full conversation in the app for details.
                </Text>
            )}
            <EmailButton href={`${baseUrl}/messages/${contextType}/${contextId}`}>Reply to Message</EmailButton>
            <Hr style={hr} />
            <Text style={footerNote}>
                You received this because you had no unread messages in this conversation.
            </Text>
        </EmailLayout>
    );
};

export default NewMessageNotification;

const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: '700', marginBottom: '16px' };
const text = { color: '#1a1a1a', fontSize: '14px', lineHeight: '24px' };
const muted = { color: '#6b7280', fontSize: '13px', lineHeight: '20px', marginBottom: '20px' };
const messagePreview = { backgroundColor: '#f6f9fc', padding: '16px', borderRadius: '6px', borderLeft: '4px solid #2563EB', margin: '20px 0' };
const messageText = { color: '#1a1a1a', fontSize: '14px', lineHeight: '22px', margin: '0' };
const hr = { borderColor: '#e6ebf1', margin: '24px 0' };
const footerNote = { color: '#8898aa', fontSize: '11px', textAlign: 'center' };