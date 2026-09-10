import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import {
    listTherapistsQuerySchema,
    therapistUserIdParamSchema,
    therapistDocumentParamSchema,
    rejectTherapistSchema,
    updateTherapistVerificationSchema,
} from "../../validators/admin.schema.js";
import {
    listTherapistsController,
    getTherapistDetailController,
    approveTherapistController,
    rejectTherapistController,
    updateTherapistVerificationController,
    getDocumentSignedUrlController,
} from "../../controllers/admin.therapist.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/therapists", ...adminOrSubAdmin, requirePermission("therapists"), validate(listTherapistsQuerySchema, "query"), listTherapistsController);
router.get("/therapists/:therapistUserId", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistUserIdParamSchema, "params"), getTherapistDetailController);
router.put("/therapists/:therapistUserId/approve", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistUserIdParamSchema, "params"), approveTherapistController);
router.put("/therapists/:therapistUserId/reject", ...adminOrSubAdmin, requirePermission("therapists"), validateMultiple({ params: therapistUserIdParamSchema, body: rejectTherapistSchema }), rejectTherapistController);
router.put("/therapists/:therapistUserId/verification", ...adminOrSubAdmin, requirePermission("therapists"), validateMultiple({ params: therapistUserIdParamSchema, body: updateTherapistVerificationSchema }), updateTherapistVerificationController);
router.get("/therapists/:therapistUserId/documents/:documentId", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistDocumentParamSchema, "params"), getDocumentSignedUrlController);

export default router;
