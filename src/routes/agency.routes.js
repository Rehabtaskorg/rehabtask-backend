import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import {
    listPatients, addPatient,
    getPatient, editPatient, deletePatient
} from "../controllers/patient.controller.js";

const router = express.Router();

// All Agency routes require authentication + customer role
router.use(authenticate);
router.use(authorize("customer"));

router.get("/patients", listPatients);
router.post("/patients", addPatient);
router.get("/patients/:patientId", getPatient);
router.put("/patients/:patientId", editPatient);
router.delete("/patients/:patientId", deletePatient);

export default router;