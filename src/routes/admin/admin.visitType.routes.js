import express from "express";
import {
    adminGetVisitTypesController,
    adminUpdateVisitTypeController,
    adminSeedVisitTypesController,
} from "../../controllers/visitType.controller.js";
import { adminOnly } from "./adminMiddleware.js";

const router = express.Router();

router.get("/visit-types", ...adminOnly, adminGetVisitTypesController);
router.put("/visit-types/:id", ...adminOnly, adminUpdateVisitTypeController);
router.post("/visit-types/seed", ...adminOnly, adminSeedVisitTypesController);

export default router;
