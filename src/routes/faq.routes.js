import express from "express";
import { getActiveFaqsController } from "../controllers/faq.controller.js";

const router = express.Router();

// GET /api/faqs — Public active FAQs
router.get("/", getActiveFaqsController);

export default router;