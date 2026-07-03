import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

    const app = getApps().length ? getApp() : initializeApp();

    tenantAuth = getAuth(app).tenantManager().authForTenant(env.IDENTITY_PLATFORM_TENANT_ID);
    return tenantAuth;
}