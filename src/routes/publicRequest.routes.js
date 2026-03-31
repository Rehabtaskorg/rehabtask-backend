import express from "express";
import { browsePublicRequestsController } from "../controllers/publicRequest.controller.js";

const router = express.Router();

// GET /api/public/requests — Browse open therapy requests (no auth required)
router.get("/requests", browsePublicRequestsController);

export default router;
