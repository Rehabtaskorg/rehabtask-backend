import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { listUsersQuerySchema, userIdParamSchema, updateUserSchema } from "../../validators/admin.schema.js";
import {
    listUsersController,
    getUserDetailController,
    deactivateUserController,
    reactivateUserController,
    updateUserController,
} from "../../controllers/admin.user.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/users", ...adminOrSubAdmin, requirePermission("users"), validate(listUsersQuerySchema, "query"), listUsersController);
router.get("/users/:userId", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), getUserDetailController);
router.put("/users/:userId", ...adminOrSubAdmin, requirePermission("users"), validateMultiple({ params: userIdParamSchema, body: updateUserSchema }), updateUserController);
router.put("/users/:userId/deactivate", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), deactivateUserController);
router.put("/users/:userId/reactivate", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), reactivateUserController);

export default router;
