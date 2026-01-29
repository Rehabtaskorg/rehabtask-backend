import dotenv from "dotenv";
dotenv.config();
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripeConfig = {
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    webhookSecretConnect: process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
    platformFeePercentage: parseInt(
        process.env.PLATFORM_FEE_PERCENTAGE || "10",
        10
    ),
};

export { stripe, stripeConfig };