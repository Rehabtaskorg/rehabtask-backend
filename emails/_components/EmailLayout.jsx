import { Body, Container, Head, Html, Text, Preview, Link, Button } from "@react-email/components";

export const EmailLayout = ({ children, preview }) => {
    return (
        <Html>
            <Head />
            {preview && <Preview>{preview}</Preview>}
            <Body style={main}>
                <Container style={container}>
                    {children}
                    <Text style={footer}>
                        RehabTask — Steadfast Rehabilitation Services
                        <br />
                        <Link href={`${process.env.FRONTEND_URL}/help`} style={footerLink}>Help Center</Link>
                        {' · '}
                        <Link href={`${process.env.FRONTEND_URL}/contact`} style={footerLink}>Contact Us</Link>
                        {' · '}
                        <Link href={`${process.env.FRONTEND_URL}/privacy`} style={footerLink}>Privacy Policy</Link>
                    </Text>

                </Container>
            </Body>
        </Html>
    );
};

export const EmailButton = ({ href, children }) => (
    <Button href={href} style={button}>
        {children}
    </Button>
);

export default EmailLayout;

// shared styles
const main = {
    backgroundColor: '#f6f9fc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif',
};

const container = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '40px 32px',
    maxWidth: '600px',
    borderRadius: '8px',
};

const footer = {
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '18px',
    marginTop: '40px',
    borderTop: '1px solid #e6ebf1',
    paddingTop: '20px',
    textAlign: 'center',
};

const footerLink = {
    color: '#8898aa',
};

const button = {
    backgroundColor: '#2563EB',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: '600',
    padding: '12px 24px',
    textDecoration: 'none',
};