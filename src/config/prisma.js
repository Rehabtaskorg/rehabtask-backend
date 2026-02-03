// @ts-nocheck
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * @typedef {import('@prisma/client').PrismaClient} PrismaClient
 * @typedef {import('@prisma/client').Prisma.TransactionClient} TransactionClient
 */
let prismaInstance;

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
});

/**
 * @type {any}
 */
const globalForPrisma = global;

/**
 * Prisma client with full autocomplete
 * @type {import("@prisma/client").PrismaClient}
 */
export const prisma =
    globalForPrisma.prisma ||
    (prismaInstance = new PrismaClient({
        adapter,
        log:
            process.env.NODE_ENV === "production"
                ? ["error"]
                : ["info", "warn", "error"],
    }));

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

// Connection retry configuration
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

/**
 * Tries to connect to the database with retries
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function connectWithRetry(prisma) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await prisma.$connect();
            console.log("Prisma connected to the database");
            return;
        } catch (error) {
            console.warn(
                `Prisma connection attempt ${attempt} failed: ${error.message}`
            );
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) =>
                    setTimeout(resolve, RETRY_DELAY_MS)
                );
            } else {
                console.error("Failed to connect to database after retries");
                throw error;
            }
        }
    }
}

// attempt connection on module load
connectWithRetry(prisma).catch((err) => {
    console.error("Prisma failed to connect after retries:", err);
});

// RLS HELPER FUNCTIONS

/**
 * Execute queries with RLS context
 * This sets the user context for Row Level Security Policies
 * 
 * @param {Object} user - User object with id
 * @param {(tx: TransactionClient) => Promise<any>} fn - Async function that receives transaction client
 * @returns {Promise<any>} - Result of the transaction
 */
export async function withRLS(user, fn) {
    if (!user || !user.id) {
        throw new Error("User context required for RLS transaction");
    }

    return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
            `SELECT set_config('request.jwt.claim.sub', '${user.id}', true)`
        );

        if (user.emailVerified) {
            await tx.$executeRawUnsafe(
                `SELECT set_config('request.jwt.claim.email_confirmed_at', '${new Date().toISOString()}', true)`
            );
        }

        if (user.role) {
            await tx.$executeRawUnsafe(
                `SELECT set_config('request.jwt.claim.role', '${user.role}', true)`
            );
        }

        return fn(tx);
    });
}

/**
 * Execute admin queries without RLS
 * Use only for system operations that need to bypass RLS
 * 
 * @param {(db:PrismaClient) => Promise<any>} fn - Async function that receives prisma client
 * @returns {Promise<any>} Result of the operation
 */
export async function withAdminAccess(fn) {
    return fn(prisma);
}