import {
    getAgencyPatients, createPatient,
    getPatientById, updatePatient, softDeletePatient,
} from "../services/patient.service.js";

/**
 * GET /agency/patients
 * List all active patients for the authenticated agency.
 */
export const listPatients = async (req, res, next) => {
    try {
        const patients = await getAgencyPatients(req.user.customerProfile);
        res.json({ success: true, data: patients });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /agency/patients
 * Create a new patient. Body validated by validate(createPatientSchema) middleware.
 */
export const addPatient = async (req, res, next) => {
    try {
        const patient = await createPatient(req.user.customerProfile, req.body);
        res.status(201).json({ success: true, data: patient });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /agency/patients/:patientId
 * Get a single patient with full request and booking history.
 */
export const getPatient = async (req, res, next) => {
    try {
        const patient = await getPatientById(req.user.customerProfile, req.params.patientId);
        res.json({ success: true, data: patient });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /agency/patients/:patientId
 * Update patient info. Body validated by validate(updatePatientSchema) middleware.
 */
export const editPatient = async (req, res, next) => {
    try {
        const patient = await updatePatient(req.user.customerProfile, req.params.patientId, req.body);
        res.json({ success: true, data: patient });
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /agency/patients/:patientId
 * Soft-delete a patient (sets isActive = false).
 */
export const deletePatient = async (req, res, next) => {
    try {
        await softDeletePatient(req.user.customerProfile, req.params.patientId);
        res.json({ success: true, message: "Patient deactivated successfully" });
    } catch (err) {
        next(err);
    }
};