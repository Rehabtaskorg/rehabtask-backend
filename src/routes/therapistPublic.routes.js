import express from "express";
import {
    searchTherapistsController,
    getTherapistPublicProfileController,
    getTherapistReviewsController,
    getPlatformStatsController,
} from "../controllers/therapist.controller.js";
import { optionalAuthenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { searchTherapistsSchema } from "../validators/therapist.schema.js";
import { apiRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// GET /api/therapists/stats — Public platform statistics for landing page
router.get("/stats", getPlatformStatsController);

// GET /api/therapists/search — Search with filters (location, specialization, pagination)
router.get(
    "/search",
    apiRateLimiter,
    optionalAuthenticate,
    validate(searchTherapistsSchema, "query"),
    searchTherapistsController
);

// GET /api/therapists/:therapistId — Public profile with rating stats
router.get(
    "/:therapistId",
    apiRateLimiter,
    optionalAuthenticate,
    getTherapistPublicProfileController
);

// GET /api/therapists/:therapistId/reviews — Paginated reviews
router.get(
    "/:therapistId/reviews",
    optionalAuthenticate,
    getTherapistReviewsController
);

export default router;