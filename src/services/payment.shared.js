import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";

export const getOrCreateStripeCustomer = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { user: true },
    });

    if (!customerProfile) throw new Error("Customer profile not found");
    if (customerProfile.stripeCustomerId) {
        return { stripeCustomerId: customerProfile.stripeCustomerId, customerProfile };
    }

    const existingCustomers = await stripe.customers.list({ email: customerProfile.user.email, limit: 1 });

    let stripeCustomerId;
    if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
    } else {
        const customer = await stripe.customers.create({
            email: customerProfile.user.email,
            name: customerProfile.fullName,
            metadata: { customerId: customerProfile.id },
        });
        stripeCustomerId = customer.id;
    }

    await prisma.customerProfile.update({ where: { id: customerProfile.id }, data: { stripeCustomerId } });

    return { stripeCustomerId, customerProfile };
};
