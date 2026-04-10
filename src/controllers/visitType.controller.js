import {
    getVisitTypes,
    getAllVisitTypes,
    createVisitType,
    updateVisitType,
    seedVisitTypes,
} from "../services/visitType.service.js";

/**
 * GET /visit-types
 *
 * Unified endpoint for both customer and therapist audiences. Accepts:
 *   - ?serviceType=Physical Therapy       (customer-facing service type)
 *   - ?licenseType=Physical Therapist     (therapist license — legacy fallback)
 *   - ?discipline=Physical Therapist      (raw discipline passthrough — legacy)
 *   - ?audience=customer|therapist        (default: therapist)
 *
 * Customer audience filters to customerVisible=true.
 * Therapist audience includes the "All" discipline bucket (Missed Visit etc.).
 *
 * If no lens is provided and the caller is authenticated as a therapist,
 * falls back to their profile's primaryLicenseType — preserves the old
 * "just call GET /visit-types with no params" behavior.
 */
export const getVisitTypesController = async (req, res, next) => {
    try {
        const { serviceType, licenseType, discipline, audience } = req.query;

        // Legacy behavior: therapist calling with no params gets their own discipline.
        const therapistProfile = req.user?.therapistProfile;
        const effectiveLicenseType =
            licenseType || (!serviceType && !discipline ? therapistProfile?.primaryLicenseType : undefined);

        const effectiveAudience = audience === "customer" ? "customer" : "therapist";

        const visitTypes = await getVisitTypes({
            discipline,
            serviceType,
            licenseType: effectiveLicenseType,
            audience: effectiveAudience,
        });

        res.json({ success: true, data: visitTypes });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /visit-types/by-discipline — legacy alias kept for older clients.
 * New code should use GET /visit-types?discipline=... or ?serviceType=...
 */
export const getVisitTypesByDisciplineController = async (req, res, next) => {
    try {
        const { discipline } = req.query;
        if (!discipline) {
            return res.status(400).json({ success: false, message: "discipline query parameter is required" });
        }
        const visitTypes = await getVisitTypes({ discipline, audience: "therapist" });
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
