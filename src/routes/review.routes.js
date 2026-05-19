import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    createReviewController,
    getCustomerReviewsController
} from "../controllers/review.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createReviewSchema } from "../validators/review.schema.js";

const router = express.Router();

// POST /api/reviews — Create review (customer, completed booking only)
router.post(
    "/",
    authenticate,
    authorize([USER_ROLES.CUSTOMER]),
    validate(createReviewSchema),
    createReviewController
);

// GET /api/reviews/my-reviews — Customer's own reviews
router.get(
    "/my-reviews",
    authenticate,
    authorize([USER_ROLES.CUSTOMER]),
    getCustomerReviewsController
);

export default router;