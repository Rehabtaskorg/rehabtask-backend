import "dotenv/config";
import { supabaseAdmin } from "../src/config/supabase.js";
import { prisma } from "../src/config/prisma.js";

async function seed() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
        process.exit(1);
    }

    // Check if admin already exists in DB
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        console.log(`Admin user already exists (${email}), skipping.`);
        return;
    }

    // Create admin in Supabase (email auto-confirmed, no verification needed)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "admin" },
    });

    if (error) {
        console.error("Failed to create admin in Supabase:", error.message);
        process.exit(1);
    }

    // Create admin user record in Prisma
    await prisma.user.create({
        data: {
            id: data.user.id,
            email,
            passwordHash: "",
            role: "admin",
            emailVerified: true,
            isActive: true,
        },
    });

    console.log(`Admin user seeded successfully: ${email}`);
}

seed()
    .catch((err) => {
        console.error("Seed failed:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
