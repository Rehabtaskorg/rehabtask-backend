import express from "express";
import {
    createDisputeController,
    getUserDisputesController,
    getDisputeByIdController
} from "../controllers/dispute.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createDisputeSchema } from "../validators/dispute.schema.js";

const router = express.Router();

// POST /api/disputes — Submit dispute
router.post(
    "/",
    authenticate,
    validate(createDisputeSchema),
    createDisputeController
);

// GET /api/disputes/my-disputes — User's own disputes
router.get(
    "/my-disputes",
    authenticate,
    getUserDisputesController
);

// GET /api/disputes/:disputeId — Single dispute (own or admin)
router.get(
    "/:disputeId",
    authenticate,
    getDisputeByIdController
);

export default router;