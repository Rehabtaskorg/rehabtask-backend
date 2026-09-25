import express from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { setCommissionRateSchema, adminListCommissionHistoryQuerySchema } from "../../validators/admin.schema.js";
import {
    getCommissionRateController,
    setCommissionRateController,
    getCommissionHistoryController,
} from "../../controllers/admin.commission.controller.js";
import { adminOrSubAdmin, adminOnly } from "./adminMiddleware.js";

const router = express.Router();

router.get("/commission/rates", ...adminOrSubAdmin, requirePermission("commission"), getCommissionRateController);
router.get("/commission/history", ...adminOrSubAdmin, requirePermission("commission"), validate(adminListCommissionHistoryQuerySchema, "query"), getCommissionHistoryController);
router.post("/commission/rates", ...adminOnly, validate(setCommissionRateSchema), setCommissionRateController);

export default router;
