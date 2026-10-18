import { BadRequestError } from "../utils/errors.js";

export const createTwoFactorControls = ({ prisma, logAction }) => ({
    async disable(user) {
        if (user.role === "admin") throw new BadRequestError("Admin two-factor authentication is mandatory", "2FA_ADMIN_MANDATORY");
        // Keep verified methods and the preference so the user can enable them again.
        const updated = await prisma.userSecuritySettings.upsert({
            where: { userId: user.id },
            update: { twoFactorEnabled: false },
            create: { userId: user.id, twoFactorEnabled: false },
        });
        await logAction({ actorId: user.id, action: "2fa.disabled", entityType: "user_security_settings", entityId: updated.id, changes: { twoFactorEnabled: false } });
    },
});
