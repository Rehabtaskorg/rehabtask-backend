import express from "express";
import { validate } from "../../middleware/validate.js";
import { sendEmailSchema } from "../../validators/admin.schema.js";
import { sendEmailController } from "../../controllers/admin.user.controller.js";
import { adminOnly } from "./adminMiddleware.js";

const router = express.Router();

// Direct email (admin-only — no sub-admin, no userId required)
router.post("/email", ...adminOnly, validate(sendEmailSchema), sendEmailController);

export default router;
