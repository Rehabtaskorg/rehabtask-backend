import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    createRequestController, getAvailableRequestsController,
    getCustomerRequestsController, getRequestByIdController,
    updateRequestController, cancelRequestController,
    getCustomerOpenRequestsController,
} from "../controllers/request.controller.js";
import { authenticate, authorize, requireCustomerApproval } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createRequestSchema, updateRequestSchema } from "../validators/request.schema.js";
import { enforceJobPostingLimit } from "../middleware/subscriptionLimits.js";

const router = express.Router();

router.post("/", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, enforceJobPostingLimit, validate(createRequestSchema), createRequestController);
router.get("/my-requests", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerRequestsController);
router.get("/available", authenticate, authorize([USER_ROLES.THERAPIST]), getAvailableRequestsController);
router.get("/by-customer/:customerUserId", authenticate, authorize([USER_ROLES.THERAPIST]), getCustomerOpenRequestsController);
router.get("/:requestId", authenticate, getRequestByIdController);
router.put("/:requestId", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, validate(updateRequestSchema), updateRequestController);
router.post("/:requestId/cancel", authenticate, authorize([USER_ROLES.CUSTOMER]), cancelRequestController);

export default router;