import express from "express";
import {
    createRequestController, getAvailableRequestsController,
    getCustomerRequestsController, getRequestByIdController
} from "../controllers/request.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.post("/", authenticate, authorize(["customer"]), createRequestController);
router.get("/my-requests", authenticate, authorize(["customer"]), getCustomerRequestsController);
router.get("/available", authenticate, authorize(["therapist"]), getAvailableRequestsController);
router.get("/:requestId", authenticate, getRequestByIdController);

export default router;