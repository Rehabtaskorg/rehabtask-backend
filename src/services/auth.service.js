import { prisma } from "../config/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * Register customer
 * 
 */
const registerCustomer = async ({ email, password, fullName, phone, location }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
        throw new Error("Email already registered");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: {
            email: normalizedEmail,
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

    const { passwordHash: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, token };
}

/**
 * Register therapist
 */
const registerTherapist = async ({ email, password, fullName, phone, specialization, licenseNumber }) => {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail }
    });

    if (existingUser) {
        throw new Error("If an account exists for this email, you’ll receive further instructions.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: {
            email: normalizedEmail,
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

    // remove password hash before returning
    const { passwordHash: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, token };
}

/**
 * Login
 */
const login = async ({ email, password }) => {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { customerProfile: true, therapistProfile: true },
    });

    if (!user) {
        return { success: false, code: "INVALID CREDENTIALS", message: "Invalid email or password" };
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
        return { success: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password" };
    }

    if (!user.isActive) {
        return { success: false, code: "ACCOUNT_DEACTIVATED", message: "Your account has been deactivated. Please contact support" };
    }

    const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const { passwordHash, ...userWithoutPassword } = user;

    return { success: true, user: userWithoutPassword, token };
};


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