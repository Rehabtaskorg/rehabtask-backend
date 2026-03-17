import { createPatientSchema, updatePatientSchema } from "../validators/patient.schema.js";
import {
    getAgencyPatients, createPatient,
    getPatientById, updatePatient, softDeletePatient
} from "../services/patient.service.js";

export const listPatients = async (req, res, next) => {
    try {
        const patients = await getAgencyPatients(req.user.customerProfile);
        res.json({ success: true, data: patients });
    } catch (err) {
        next(err);
    }
}

export const addPatient = async (req, res, next) => {
    try {
        const parsed = createPatientSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: parsed.error.errors,
            });
        }
        const patient = await createPatient(req.user.customerProfile, parsed.data);
        res.status(201).json({ success: true, data: patient });
    } catch (err) {
        next(err);
    }
}

export const getPatient = async (req, res, next) => {
    try {
        const patient = await getPatientById(req.user.customerProfile, req.params.patientId);
        res.json({ success: true, data: patient });
    } catch (error) {
        next(error);
    }
};

export const editPatient = async (req, res, next) => {
    try {
        const parsed = updatePatientSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: parsed.error.errors,
            });
        }
        const patient = await updatePatient(req.user.customerProfile, req.params.patientId, parsed.data);
        res.json({ success: true, data: patient });
    } catch (error) {
        next(error);
    }
}

export const deletePatient = async (req, res, next) => {
    try {
        await softDeletePatient(req.user.customerProfile, req.params.patientId);
        res.json({ success: true, message: "Patient deactivated successfully" });
    } catch (error) {
        next(error);
    }
}