import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    acceptOfferController, createOfferController,
    getOfferByIdController, getTherapistOffersController,
    declineOfferController, requestOfferChangeController,
    withdrawOfferController,
    reviseOfferController
} from "../controllers/offer.controller.js";
import { authenticate, authorize, requireCustomerApproval } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requestChangeSchema } from "../validators/offer.schema.js";
import { enforceVisitLimit } from "../middleware/subscriptionLimits.js";

const router = express.Router();

// Therapist routes
router.post("/", authenticate, authorize([USER_ROLES.THERAPIST]), createOfferController);
router.get("/my-offers", authenticate, authorize([USER_ROLES.THERAPIST]), getTherapistOffersController);
router.get("/:offerId", authenticate, authorize([USER_ROLES.THERAPIST, USER_ROLES.CUSTOMER]), getOfferByIdController)
router.put("/:offerId/revise", authenticate, authorize([USER_ROLES.THERAPIST]), reviseOfferController);
router.post("/:offerId/withdraw", authenticate, authorize([USER_ROLES.THERAPIST]), withdrawOfferController);


// Customer routes
router.post("/:offerId/accept", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, enforceVisitLimit, acceptOfferController);
router.post("/:offerId/decline", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, declineOfferController);
router.post("/:offerId/request-change", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, validate(requestChangeSchema), requestOfferChangeController);

export default router;