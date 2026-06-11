import {
    getVisitTypes,
    getAllVisitTypes,
    updateVisitType,
    seedVisitTypes,
} from "../services/visitType.service.js";

export const getVisitTypesController = async (req, res, next) => {
    try {
        const { serviceType, licenseType, discipline, audience } = req.query;

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

export const adminGetVisitTypesController = async (req, res, next) => {
    try {
        const visitTypes = await getAllVisitTypes();
        res.json({ success: true, data: visitTypes });
    } catch (error) {
        next(error);
    }
};

export const adminUpdateVisitTypeController = async (req, res, next) => {
    try {
        const { isActive, customerVisible } = req.body;
        const visitType = await updateVisitType(req.params.id, { isActive, customerVisible });
        res.json({ success: true, data: visitType });
    } catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ success: false, message: "Visit type not found" });
        }
        next(error);
    }
};

export const adminSeedVisitTypesController = async (req, res, next) => {
    try {
        const result = await seedVisitTypes();
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};
