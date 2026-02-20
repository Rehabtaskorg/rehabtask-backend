import express from "express";
import {
    acceptOfferController, createOfferController,
    getOfferByIdController,
    getTherapistOffersController
} from "../controllers/offer.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.post("/", authenticate, authorize(["therapist"]), createOfferController);
router.get("/my-offers", authenticate, authorize(["therapist"]), getTherapistOffersController);

// Get single offer by ID (therapist, read-only, for offer widget in messages)
router.get("/:offerId", authenticate, authorize(["therapist"]), getOfferByIdController)

router.post("/:offerId/accept", authenticate, authorize(["customer"]), acceptOfferController);

export default router;