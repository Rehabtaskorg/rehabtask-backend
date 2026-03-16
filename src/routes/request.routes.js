import express from "express";
import {
    createRequestController, getAvailableRequestsController,
    getCustomerRequestsController, getRequestByIdController
} from "../controllers/request.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createRequestSchema } from "../validators/request.schema.js";
import { enforceRequestLimit } from "../middleware/subscriptionLimits.js";

const router = express.Router();

router.post("/", authenticate, authorize(["customer"]), enforceRequestLimit, validate(createRequestSchema), createRequestController);
router.get("/my-requests", authenticate, authorize(["customer"]), getCustomerRequestsController);
router.get("/available", authenticate, authorize(["therapist"]), getAvailableRequestsController);
router.get("/:requestId", authenticate, getRequestByIdController);

export default router;