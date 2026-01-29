import { Body, Container, Head, Html, Text, Preview } from "@react-email/components";

export const EmailLayout = ({ children, preview }) => {
    return (
        <Html>
            <Head />
            {preview && <Preview>{preview}</Preview>}
            <Body style={main}>
                <Container style={container}>
                    {children}

                    <Text style={footer}>
                        RehabTask - STEADFAST REHABILITATION SERVICES
                        <br />
                        <a href={`${process.env.FRONTEND_URL}/help`} style={footerLink}>
                            Help Center
                        </a>
                        {' . '}
                        <a href={`${process.env.FRONTEND_URL}/contact`} style={footerLink}>
                            Contact Us
                        </a>
                        {' . '}
                        <a href={`${process.env.FRONTEND_URL}/privacy`} style={footerLink}>
                            Privacy Policy
                        </a>
                    </Text>

                </Container>
            </Body>
        </Html>
    )
}

export default EmailLayout;

// shared styles
const main = {

}

const container = {

}

const footer = {

}

const footerLink = {

}