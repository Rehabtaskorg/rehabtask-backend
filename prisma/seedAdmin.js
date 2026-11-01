import "dotenv/config";
import { prisma } from "../src/config/prisma.js";
import { getIdentityPlatformAuth } from "../src/config/identityPlatform.js";

async function seedAdmin() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
        process.exit(1);
    }

    const auth = getIdentityPlatformAuth();

    let authUser = await auth.getUserByEmail(email).catch(() => null);

    if (authUser) {
        await auth.updateUser(authUser.uid, { password, emailVerified: true });
        console.log(`Identity Platform user already existed for ${email} — password reset.`);
    } else {
        authUser = await auth.createUser({
            email,
            password,
            emailVerified: true,
            displayName: "Admin",
        });
        console.log(`Identity Platform user created for ${email} (uid ${authUser.uid}).`);
    }

    await prisma.user.upsert({
        where: { email },
        update: { id: authUser.uid, role: "admin", emailVerified: true, isActive: true },
        create: {
            id: authUser.uid,
            email,
            passwordHash: "",
            role: "admin",
            emailVerified: true,
            isActive: true,
        },
    });

    console.log(`Local DB admin row upserted for ${email} (id ${authUser.uid}).`);
}

seedAdmin()
    .catch((err) => {
        console.error("Admin seed failed:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());