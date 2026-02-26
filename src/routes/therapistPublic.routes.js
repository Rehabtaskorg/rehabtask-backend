import express from "express";
import {
    searchTherapistsController,
    getTherapistPublicProfileController,
    getTherapistReviewsController
} from "../controllers/therapist.controller.js";
import { optionalAuthenticate } from "../middleware/auth.js";
import { validate, validateMultiple } from "../middleware/validate.js";
import {
    searchTherapistsSchema,
    therapistIdParamSchema,
    reviewsPaginationSchema
} from "../validators/therapist.schema.js";

const router = express.Router();

// GET /api/therapists/search — Search with filters (location, specialization, pagination)
router.get(
    "/search",
    optionalAuthenticate,
    validate(searchTherapistsSchema, "query"),
    searchTherapistsController
);

// GET /api/therapists/:therapistId — Public profile with rating stats
router.get(
    "/:therapistId",
    optionalAuthenticate,
    getTherapistPublicProfileController
);

// GET /api/therapists/:therapistId/reviews — Paginated reviews
router.get(
    "/:therapistId/reviews",
    getTherapistReviewsController
);

export default router;