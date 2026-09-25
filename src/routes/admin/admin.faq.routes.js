import express from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { createFaqSchema, updateFaqSchema } from "../../validators/faq.schema.js";
import {
    adminGetAllFaqsController,
    adminCreateFaqController,
    adminUpdateFaqController,
    adminDeleteFaqController,
} from "../../controllers/admin.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/faqs", ...adminOrSubAdmin, requirePermission("faqs"), adminGetAllFaqsController);
router.post("/faqs", ...adminOrSubAdmin, requirePermission("faqs"), validate(createFaqSchema), adminCreateFaqController);
router.put("/faqs/:faqId", ...adminOrSubAdmin, requirePermission("faqs"), validate(updateFaqSchema), adminUpdateFaqController);
router.delete("/faqs/:faqId", ...adminOrSubAdmin, requirePermission("faqs"), adminDeleteFaqController);

export default router;
