import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import {
    adminListDisputesQuerySchema,
    disputeIdParamSchema,
    assignDisputeSchema,
    adminUpdateDisputeSchema,
} from "../../validators/admin.schema.js";
import {
    adminListDisputesController,
    adminGetDisputeController,
    assignDisputeController,
    adminUpdateDisputeController,
    reopenDisputeController,
} from "../../controllers/admin.dispute.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/disputes", ...adminOrSubAdmin, requirePermission("disputes"), validate(adminListDisputesQuerySchema, "query"), adminListDisputesController);
router.get("/disputes/:disputeId", ...adminOrSubAdmin, requirePermission("disputes"), validate(disputeIdParamSchema, "params"), adminGetDisputeController);
router.put("/disputes/:disputeId", ...adminOrSubAdmin, requirePermission("disputes"), validateMultiple({ params: disputeIdParamSchema, body: adminUpdateDisputeSchema }), adminUpdateDisputeController);
router.put("/disputes/:disputeId/assign", ...adminOrSubAdmin, requirePermission("disputes"), validateMultiple({ params: disputeIdParamSchema, body: assignDisputeSchema }), assignDisputeController);
router.put("/disputes/:disputeId/reopen", ...adminOrSubAdmin, requirePermission("disputes"), validate(disputeIdParamSchema, "params"), reopenDisputeController);

export default router;
