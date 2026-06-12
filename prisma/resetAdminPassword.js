import "dotenv/config";
import { supabaseAdmin } from "../src/config/supabase.js";
import { prisma } from "../src/config/prisma.js";

async function resetAdminPassword() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
        process.exit(1);
    }

    let existingAuthUser = null;
    let page = 1;
    while (!existingAuthUser) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) {
            console.error("Failed to list Supabase users:", error.message);
            process.exit(1);
        }
        existingAuthUser = data.users.find((u) => u.email === email);
        if (data.users.length === 0) break;
        page++;
    }

    if (existingAuthUser) {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, { password });
        if (updateError) {
            console.error("Failed to update password:", updateError.message);
            process.exit(1);
        }
        console.log(`Password updated successfully for ${email}`);
        return;
    }

    const localUser = await prisma.user.findUnique({ where: { email } });
    if (!localUser) {
        console.error(`No Supabase auth user or local DB user found for ${email}`);
        process.exit(1);
    }

    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        id: localUser.id,
        email,
        password,
        email_confirm: true,
        user_metadata: { role: localUser.role },
    });

    if (createError) {
        console.error("Failed to create Supabase auth user:", createError.message);
        process.exit(1);
    }

    console.log(`Supabase auth user created and password set for ${email} (linked to existing DB id ${localUser.id})`);
}

resetAdminPassword().catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
}).finally(() => prisma.$disconnect());