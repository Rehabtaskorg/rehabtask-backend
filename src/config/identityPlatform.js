import admin from "firebase-admin";
import { env } from "./env.js";

let tenantAuth = null;

/**
 * Initialise Firebase Admin SDK and return a tenant-scoped auth client.
 * Called once at startup — subsequent calls return the cached instance.
 *
 * @returns {import("firebase-admin/auth").TenantAwareAuth}
 */
export function getIdentityPlatformAuth() {
    if (tenantAuth) return tenantAuth;

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    tenantAuth = admin.auth().tenantManager().authForTenant(env.IDENTITY_PLATFORM_TENANT_ID);
    return tenantAuth;
}
