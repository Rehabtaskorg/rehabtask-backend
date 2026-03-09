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
        // If user already exists in Supabase but not in our DB, fetch them
        if (error.message.includes("already been registered")) {
            console.log(`Admin already exists in Supabase, syncing to local DB...`);
            const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
            const supabaseUser = users.find((u) => u.email === email);
            if (supabaseUser) {
                await prisma.user.upsert({
                    where: { id: supabaseUser.id },
                    update: {},
                    create: {
                        id: supabaseUser.id,
                        email,
                        passwordHash: "",
                        role: "admin",
                        emailVerified: true,
                        isActive: true,
                    },
                });
                console.log(`Admin user synced successfully: ${email}`);
                return;
            }
        }
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

async function seedRequestOptions() {
    const defaults = [
        { type: "visit_type", value: "Initial Evaluation" },
        { type: "visit_type", value: "Follow-Up Visit" },
        { type: "visit_type", value: "Re-Evaluation" },
        { type: "visit_type", value: "Discharge Visit" },
        { type: "emr", value: "Axxess" },
        { type: "emr", value: "KanTime" },
        { type: "emr", value: "WellSky" },
        { type: "emr", value: "PointCare" },
        { type: "emr", value: "HCHB (HomeCare HomeBase)" },
        { type: "emr", value: "MatrixCare" },
    ];

    let created = 0;
    for (const option of defaults) {
        await prisma.requestOption.upsert({
            where: {
                type_value: { type: option.type, value: option.value },
            },
            update: {},
            create: { ...option, isDefault: true },
        });
        created++;
    }

    console.log(`Request options seeded: ${created} defaults ensured`);
}

seed()
    .then(() => seedRequestOptions())
    .catch((err) => {
        console.error("Seed failed:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
