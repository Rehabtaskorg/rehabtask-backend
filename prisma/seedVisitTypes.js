import "dotenv/config";
import { prisma } from "../src/config/prisma.js";
import { seedVisitTypes } from "../src/services/visitType.service.js";

seedVisitTypes()
    .catch((err) => {
        console.error("Visit type seed failed:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
