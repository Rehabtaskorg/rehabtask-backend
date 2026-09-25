import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import { authenticate, authorize, requireCustomerApproval } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createPatientSchema, updatePatientSchema } from "../validators/patient.schema.js";
import {
    listPatients, addPatient,
    getPatient, editPatient, deletePatient,
} from "../controllers/patient.controller.js";

const router = express.Router();

router.use(authenticate);
router.use(authorize(USER_ROLES.CUSTOMER));

router.get("/patients", listPatients);
router.post("/patients", requireCustomerApproval, validate(createPatientSchema), addPatient);
router.get("/patients/:patientId", getPatient);
router.put("/patients/:patientId", requireCustomerApproval, validate(updatePatientSchema), editPatient);
router.delete("/patients/:patientId", requireCustomerApproval, deletePatient);

export default router;