import express from "express";
import { validate } from "../../middleware/validate.js";
import { adminListAuditLogsQuerySchema } from "../../validators/admin.schema.js";
import { adminListAuditLogsController } from "../../controllers/admin.audit.controller.js";
import { adminOnly } from "./adminMiddleware.js";

const router = express.Router();

// Audit Logs — full admins only (append-only, no sub-admin access)
router.get("/audit-logs", ...adminOnly, validate(adminListAuditLogsQuerySchema, "query"), adminListAuditLogsController);

export default router;
