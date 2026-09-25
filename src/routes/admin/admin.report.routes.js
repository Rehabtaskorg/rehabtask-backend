import express from "express";
import { validate } from "../../middleware/validate.js";
import { adminReportQuerySchema, adminUserReportQuerySchema } from "../../validators/admin.schema.js";
import {
    bookingsReportController,
    paymentsReportController,
    usersReportController,
} from "../../controllers/admin.report.controller.js";
import { adminOnly } from "./adminMiddleware.js";

const router = express.Router();

// Reports — full admins only
router.get("/reports/bookings", ...adminOnly, validate(adminReportQuerySchema, "query"), bookingsReportController);
router.get("/reports/payments", ...adminOnly, validate(adminReportQuerySchema, "query"), paymentsReportController);
router.get("/reports/users", ...adminOnly, validate(adminUserReportQuerySchema, "query"), usersReportController);

export default router;
