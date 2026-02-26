import express from "express";
import {
    adminGetAllFaqsController,
    adminCreateFaqController,
    adminUpdateFaqController,
    adminDeleteFaqController,
    adminGetAllDisputesController,
    adminResolveDisputeController,
} from "../controllers/admin.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate, validateMultiple } from "../middleware/validate.js";
import {
    createFaqSchema,
    updateFaqSchema,
    faqIdParamSchema,
} from "../validators/faq.schema.js";
import {
    updateDisputeSchema,
    listDisputesQuerySchema,
} from "../validators/dispute.schema.js";

const router = express.Router();

// ── FAQ Management ──

// GET /api/admin/faqs — All FAQs including inactive
router.get(
    "/faqs",
    authenticate,
    authorize(["admin"]),
    adminGetAllFaqsController
);

// POST /api/admin/faqs — Create FAQ
router.post(
    "/faqs",
    authenticate,
    authorize(["admin"]),
    validate(createFaqSchema),
    adminCreateFaqController
);

// PUT /api/admin/faqs/:faqId — Update FAQ
router.put(
    "/faqs/:faqId",
    authenticate,
    authorize(["admin"]),
    validate(updateFaqSchema),
    adminUpdateFaqController
);

// DELETE /api/admin/faqs/:faqId — Delete FAQ
router.delete(
    "/faqs/:faqId",
    authenticate,
    authorize(["admin"]),
    adminDeleteFaqController
);

// ── Dispute Management ──

// GET /api/admin/disputes — All disputes (filterable)
router.get(
    "/disputes",
    authenticate,
    authorize(["admin"]),
    validate(listDisputesQuerySchema, "query"),
    adminGetAllDisputesController
);

// PUT /api/admin/disputes/:disputeId — Resolve dispute
router.put(
    "/disputes/:disputeId",
    authenticate,
    authorize(["admin"]),
    validate(updateDisputeSchema),
    adminResolveDisputeController
);

export default router;