import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import {
    userIdParamSchema,
    createSubAdminSchema,
    promoteToSubAdminSchema,
    updateSubAdminPermissionsSchema,
} from "../../validators/admin.schema.js";
import {
    listSubAdminsController,
    getSubAdminDetailController,
    createSubAdminController,
    promoteToSubAdminController,
    updateSubAdminPermissionsController,
    deactivateSubAdminController,
    reactivateSubAdminController,
    resendSubAdminInviteController,
} from "../../controllers/admin.subadmin.controller.js";
import { adminOnly } from "./adminMiddleware.js";

const router = express.Router();

router.get("/sub-admins", ...adminOnly, listSubAdminsController);
router.post("/sub-admins", ...adminOnly, validate(createSubAdminSchema), createSubAdminController);
router.get("/sub-admins/:userId", ...adminOnly, validate(userIdParamSchema, "params"), getSubAdminDetailController);
router.post("/sub-admins/:userId/promote", ...adminOnly, validateMultiple({ params: userIdParamSchema, body: promoteToSubAdminSchema }), promoteToSubAdminController);
router.put("/sub-admins/:userId/permissions", ...adminOnly, validateMultiple({ params: userIdParamSchema, body: updateSubAdminPermissionsSchema }), updateSubAdminPermissionsController);
router.put("/sub-admins/:userId/deactivate", ...adminOnly, validate(userIdParamSchema, "params"), deactivateSubAdminController);
router.put("/sub-admins/:userId/reactivate", ...adminOnly, validate(userIdParamSchema, "params"), reactivateSubAdminController);
router.post("/sub-admins/:userId/resend-invite", ...adminOnly, validate(userIdParamSchema, "params"), resendSubAdminInviteController);

export default router;
