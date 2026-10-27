import crypto from "node:crypto";
import { BadRequestError, ConflictError } from "../utils/errors.js";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const equal = (a, b) => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const invalid = () => new BadRequestError("Phone verification is invalid or expired. Request a new code.", "PHONE_VERIFICATION_INVALID");

// Dependencies are supplied so verification can be tested without sending real SMS.
export const createSignupPhoneService = ({ prisma, sendSms }) => ({
    async start({ email, phone, ipAddress }) {
        const now = new Date();
        const since = new Date(now.getTime() - 15 * 60 * 1000);
        // A transaction serializes sends for this destination, including parallel requests.
        const { challenge, challengeToken, code } = await prisma.$transaction(async (db) => {
            await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`signup-ip:${ipAddress}`}))`;
            await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;
            const latest = await db.signupPhoneChallenge.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } });
            if (latest && now - latest.createdAt < 60_000) throw new ConflictError("Please wait 60 seconds before requesting another code", "PHONE_RESEND_COOLDOWN");
            const [phoneCount, ipCount] = await Promise.all([
                db.signupPhoneChallenge.count({ where: { phone, createdAt: { gte: since } } }),
                db.signupPhoneChallenge.count({ where: { ipAddress, createdAt: { gte: since } } }),
            ]);
            if (phoneCount >= 5 || ipCount >= 15) throw new ConflictError("Too many verification requests. Please try again later.", "PHONE_SEND_LIMIT");
            const challengeToken = crypto.randomBytes(32).toString("hex");
            const code = crypto.randomInt(100000, 1000000).toString();
            await db.signupPhoneChallenge.updateMany({ where: { phone, status: "pending" }, data: { status: "cancelled" } });
            const challenge = await db.signupPhoneChallenge.create({ data: {
                email: email.toLowerCase().trim(), phone, ipAddress,
                tokenHash: hash(challengeToken), codeHash: hash(`${challengeToken}:${code}`),
                expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
            } });
            return { challenge, challengeToken, code };
        });
        try {
            await sendSms({ to: phone, body: `Your RehabTask signup code is ${code}. It expires in 10 minutes. Do not share this code.`, requireDelivery: true });
        } catch {
            await prisma.signupPhoneChallenge.update({ where: { id: challenge.id }, data: { status: "failed" } });
            throw new BadRequestError("Unable to send your phone verification code. Please try again.", "PHONE_DELIVERY_FAILED");
        }
        return { challengeId: challenge.id, challengeToken, destination: `••• ••• ${phone.slice(-4)}`, expiresAt: challenge.expiresAt };
    },

    async verify({ email, phone, phoneVerification }) {
        if (!phoneVerification) throw invalid();
        const { challengeId, challengeToken, code } = phoneVerification;
        // Claim an attempt atomically so concurrent requests cannot bypass the attempt limit.
        const claimed = await prisma.signupPhoneChallenge.updateMany({
            where: { id: challengeId, email: email.toLowerCase().trim(), phone, tokenHash: hash(challengeToken), status: "pending", expiresAt: { gt: new Date() }, attemptCount: { lt: 5 } },
            data: { attemptCount: { increment: 1 } },
        });
        if (claimed.count !== 1) throw invalid();
        const challenge = await prisma.signupPhoneChallenge.findUnique({ where: { id: challengeId } });
        if (!equal(hash(`${challengeToken}:${code}`), challenge.codeHash)) {
            throw new BadRequestError("The phone verification code is incorrect. Please try again.", "PHONE_CODE_INVALID");
        }
        return challenge.id;
    },

    // Consume inside the account/profile transaction, so a code cannot create multiple accounts.
    async consume(db, challengeId) {
        const result = await db.signupPhoneChallenge.updateMany({
            where: { id: challengeId, status: "pending", expiresAt: { gt: new Date() } }, data: { status: "consumed" },
        });
        if (result.count !== 1) throw invalid();
    },
});

export const signupSmsSettings = (phone) => ({
    twoFactorEnabled: true, preferredMethod: "sms", smsTwoFactorEnabled: true,
    phoneNumber: phone, phoneVerifiedAt: new Date(), twoFactorEnabledAt: new Date(),
});
