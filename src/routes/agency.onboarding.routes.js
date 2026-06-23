import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { USER_ROLES } from "../utils/constants.js";
import { agencyBusinessProfileSchema } from "../validators/onboarding.schema.js";
import {
    getAgencyOnboardingStatusController,
    getAgencyOnboardingDataController,
    saveAgencyBusinessProfileController,
} from "../controllers/onboarding.controller.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize(USER_ROLES.CUSTOMER));

router.get("/status", getAgencyOnboardingStatusController);
router.get("/data", getAgencyOnboardingDataController);
router.post("/business-profile", validate(agencyBusinessProfileSchema), saveAgencyBusinessProfileController);

export default router;