import express from "express";
import {
    acceptOfferController, createOfferController,
    getTherapistOffersController
} from "../controllers/offer.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.post("/", authenticate, authorize(["therapist"]), createOfferController);
router.get("/my-offers", authenticate, authorize(["therapist"]), getTherapistOffersController);
router.post("/:offerId/accept", authenticate, authorize(["customer"]), acceptOfferController);

export default router;