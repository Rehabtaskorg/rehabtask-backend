// @ts-nocheck
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * @type {import("@prisma/client").PrismaClient}
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