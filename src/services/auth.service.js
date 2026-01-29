import { prisma } from "../config/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * Register customer
 */
const registerCustomer = async ({ email, password, fullName, phone, location }) => {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
        throw new Error("Email already registered");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: {
            email,
            passwordHash,
            role: "customer",
            emailVerified: true, // skip email verification
            customerProfile: {
                create: {
                    fullName,
                    phone,
                    location
                },
            },
        },
        include: {
            customerProfile: true
        },
    });

    const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return { user, token };
}

/**
 * Register therapist
 */
const registerTherapist = async ({ email, password, fullName, phone, specialization, licenseNumber }) => {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
        throw new Error("If an account exists for this email, you’ll receive further instructions.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: {
            email,
            passwordHash,
            role: "therapist",
            emailVerified: true,
            therapistProfile: {
                create: {
                    fullName,
                    phone,
                    specialization,
                    licenseNumber,
                    approvalStatus: "approved", // Auto-approve for MVP testing
                },
            },
        },
        include: {
            therapistProfile: true
        },
    });

    const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return { user, token };
}

/**
 * Login
 */
const login = async ({ email, password }) => {
    const user = await prisma.user.findUnique({
        where: { email },
        include: {
            customerProfile: true,
            therapistProfile: true,
        },
    });

    // temporary debug
    console.log({ email, password }); // from frontend
    console.log(user?.email, user?.passwordHash, user?.isActive);


    if (!user) {
        throw new Error("Invalid credentials");
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
        throw new Error("Invalid credentials");
    }

    if (!user.isActive) {
        throw new Error("Account is deactivated");
    }

    const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Remove the password from response
    const { passwordHash, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, token };
}

/**
 * Get current user
 */
const getCurrentUser = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            customerProfile: true,
            therapistProfile: true,
        },
    });

    if (!user) {
        throw new Error("User not found");
    }

    const { passwordHash, ...userWithoutPassword } = user;

    return userWithoutPassword;
}

export { registerCustomer, registerTherapist, login, getCurrentUser };