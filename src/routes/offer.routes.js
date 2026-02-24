import express from "express";
import {
    acceptOfferController, createOfferController,
    getOfferByIdController, getTherapistOffersController,
    declineOfferController, requestOfferChangeController,
    withdrawOfferController,
    reviseOfferController
} from "../controllers/offer.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requestChangeSchema } from "../validators/offer.schema.js";

const router = express.Router();

// Therapist routes
router.post("/", authenticate, authorize(["therapist"]), createOfferController);
router.get("/my-offers", authenticate, authorize(["therapist"]), getTherapistOffersController);
router.get("/:offerId", authenticate, authorize(["therapist"]), getOfferByIdController)
router.put("/:offerId/revise", authenticate, authorize(["therapist"]), reviseOfferController);
router.post("/:offerId/withdraw", authenticate, authorize(["therapist"]), withdrawOfferController);


// Customer routes
router.post("/:offerId/accept", authenticate, authorize(["customer"]), acceptOfferController);
router.post("/:offerId/decline", authenticate, authorize(["customer"]), declineOfferController);
router.post("/:offerId/request-change", authenticate, authorize(["customer"]), validate(requestChangeSchema), requestOfferChangeController);

export default router;