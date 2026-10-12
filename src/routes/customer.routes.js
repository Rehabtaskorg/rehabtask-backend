import express from "express";
import { USER_ROLES } from "../utils/constants.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { updateCustomerProfileSchema } from "../validators/customer.schema.js";
import { getCustomerProfileController, updateCustomerProfileController } from "../controllers/customer.controller.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize([USER_ROLES.CUSTOMER]));

router.get("/profile", getCustomerProfileController);
router.put("/profile", validate(updateCustomerProfileSchema), updateCustomerProfileController);

export default router;
