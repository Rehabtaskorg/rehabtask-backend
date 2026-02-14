/**
 * Key Features:
 * - Direct Supabase uploads (FE -> Supabase -> backend validates)
 * - Public profile images (5MB, cached by CDN)
 * - Private license documents (10MB, signed URls with 60s expiry)
 * - File validation (size, MIME type, server-side)
 * - Database-safe migrations (nullable fiels, won't break existing DBs)
 * - Progress tracking (5 steps, auto-calculated, completion)
 * - Approval workflow (auto-set's to 'review' after completion)
 * - Security (RLS policies, signed URLs, ownership verification)
 * 
 * 
 * Enhanced LicenseDocument table to the true source of truth with:
 * userId = Direct ownership verification
 * bucket = Which storage bucket
 * mimeType = Validated file type
 * status = pending/approved/rejected
 * verifiedAt/By = Admin approval workflow
 * uploadIp = Security audit trail
 * isDeleted = Soft delete (never lose data)
 * Indexes = Fast queries for dashboards
 * 
 * Storage is just a "dumb blob storage", it doesn't understand:
 * - Business logic
 * - Ownership (beyond folder name)
 * - Audit trails
 * - Rate limiting
 * - Admin workflows
 */