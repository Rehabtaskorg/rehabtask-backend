import { getVisitTypesByDiscipline, getAllVisitTypes, createVisitType, updateVisitType, seedVisitTypes } from "../services/visitType.service.js";

/**
 * GET /visit-types — therapist gets visit types for their discipline
 */
export const getVisitTypesController = async (req, res, next) => {
    try {
        const therapist = req.user.therapistProfile;
        if (!therapist) {
            return res.status(403).json({ success: false, message: "Only therapists can access visit types" });
        }

        const licenseType = therapist.primaryLicenseType || "";
        const visitTypes = await getVisitTypesByDiscipline(licenseType);
        res.json({ success: true, data: visitTypes });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /visit-types/all — public list filtered by discipline query param
 */
export const getVisitTypesByDisciplineController = async (req, res, next) => {
    try {
        const { discipline } = req.query;
        if (!discipline) {
            return res.status(400).json({ success: false, message: "discipline query parameter is required" });
        }
        const visitTypes = await getVisitTypesByDiscipline(discipline);
        res.json({ success: true, data: visitTypes });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /admin/visit-types — admin gets all visit types
 */
export const adminGetVisitTypesController = async (req, res, next) => {
    try {
        const visitTypes = await getAllVisitTypes();
        res.json({ success: true, data: visitTypes });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /admin/visit-types — admin creates a visit type
 */
export const adminCreateVisitTypeController = async (req, res, next) => {
    try {
        const visitType = await createVisitType(req.body);
        res.status(201).json({ success: true, data: visitType });
    } catch (error) {
        if (error.code === "P2002") {
            return res.status(409).json({ success: false, message: "A visit type with this code already exists" });
        }
        next(error);
    }
};

/**
 * PUT /admin/visit-types/:id — admin updates a visit type
 */
export const adminUpdateVisitTypeController = async (req, res, next) => {
    try {
        const visitType = await updateVisitType(req.params.id, req.body);
        res.json({ success: true, data: visitType });
    } catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Visit type not found" });
        }
        next(error);
    }
};

/**
 * POST /admin/visit-types/seed — admin seeds initial visit types
 */
export const adminSeedVisitTypesController = async (req, res, next) => {
    try {
        const result = await seedVisitTypes();
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};