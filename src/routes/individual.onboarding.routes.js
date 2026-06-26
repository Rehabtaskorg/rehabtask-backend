import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { USER_ROLES } from "../utils/constants.js";
import { individualPersonalInfoSchema, individualMedicalInfoSchema, individualSignConsentSchema } from "../validators/onboarding.schema.js";
import {
    getIndividualOnboardingStatusController,
    getIndividualOnboardingDataController,
    saveIndividualPersonalInfoController,
    saveIndividualMedicalInfoController,
    uploadIndividualDocumentController,
    deleteIndividualDocumentController,
    getIndividualConsentContentController,
    signIndividualConsentController,
    completeIndividualOnboardingController,
} from "../controllers/onboarding.controller.js";
import { uploadDocument as uploadDocumentMiddleware, handleMulterError } from "../middleware/upload.middleware.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize(USER_ROLES.CUSTOMER));

router.get("/status", getIndividualOnboardingStatusController);
router.get("/data", getIndividualOnboardingDataController);
router.post("/personal-info", validate(individualPersonalInfoSchema), saveIndividualPersonalInfoController);
router.post("/medical-info", validate(individualMedicalInfoSchema), saveIndividualMedicalInfoController);
router.post("/upload-document", uploadDocumentMiddleware, handleMulterError, uploadIndividualDocumentController);
router.delete("/document/:documentId", deleteIndividualDocumentController);
router.get("/consent/content/:documentType", getIndividualConsentContentController);
router.post("/consent/sign", validate(individualSignConsentSchema), signIndividualConsentController);
router.post("/complete", completeIndividualOnboardingController);

export default router;