import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import {
    listCustomersQuerySchema,
    customerUserIdParamSchema,
    customerDocumentParamSchema,
    rejectCustomerSchema,
} from "../../validators/admin.schema.js";
import {
    listCustomersController,
    getCustomerDetailController,
    approveCustomerController,
    rejectCustomerController,
    getCustomerDocumentSignedUrlController,
    clearCustomerReReviewController,
} from "../../controllers/admin.customer.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/customers", ...adminOrSubAdmin, requirePermission("customers"), validate(listCustomersQuerySchema, "query"), listCustomersController);
router.get("/customers/:customerUserId", ...adminOrSubAdmin, requirePermission("customers"), validate(customerUserIdParamSchema, "params"), getCustomerDetailController);
router.put("/customers/:customerUserId/approve", ...adminOrSubAdmin, requirePermission("customers"), validate(customerUserIdParamSchema, "params"), approveCustomerController);
router.put("/customers/:customerUserId/reject", ...adminOrSubAdmin, requirePermission("customers"), validateMultiple({ params: customerUserIdParamSchema, body: rejectCustomerSchema }), rejectCustomerController);
router.put("/customers/:customerUserId/clear-review", ...adminOrSubAdmin, requirePermission("customers"), validate(customerUserIdParamSchema, "params"), clearCustomerReReviewController);
router.get("/customers/:customerUserId/documents/:documentId", ...adminOrSubAdmin, requirePermission("customers"), validate(customerDocumentParamSchema, "params"), getCustomerDocumentSignedUrlController);

export default router;
