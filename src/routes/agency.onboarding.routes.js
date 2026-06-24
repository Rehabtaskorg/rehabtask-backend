import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { USER_ROLES } from "../utils/constants.js";
import { agencyBusinessProfileSchema, agencyUploadDocumentsSchema } from "../validators/onboarding.schema.js";
import {
    getAgencyOnboardingStatusController,
    getAgencyOnboardingDataController,
    saveAgencyBusinessProfileController,
    uploadAgencyDocumentController,
    saveAgencyUploadDocumentsController,
    deleteAgencyDocumentController,
} from "../controllers/onboarding.controller.js";
import { uploadDocument as uploadDocumentMiddleware, handleMulterError } from "../middleware/upload.middleware.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize(USER_ROLES.CUSTOMER));

router.get("/status", getAgencyOnboardingStatusController);
router.get("/data", getAgencyOnboardingDataController);
router.post("/business-profile", validate(agencyBusinessProfileSchema), saveAgencyBusinessProfileController);
router.post("/upload-document", uploadDocumentMiddleware, handleMulterError, uploadAgencyDocumentController);
router.post("/save-upload-documents", validate(agencyUploadDocumentsSchema), saveAgencyUploadDocumentsController);
router.delete("/document/:documentId", deleteAgencyDocumentController);

export default router;