import { getOptionsByType } from "../services/requestOption.service.js";

export const getRequestOptionsController = async (req, res, next) => {
    try {
        const { type } = req.query;

        if (!type || !["visit_type", "emr"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "Query parameter 'type' must be 'visit_type' or 'emr'",
            });
        }

        const options = await getOptionsByType(type);

        res.status(200).json({
            success: true,
            data: options,
        });
    } catch (error) {
        next(error);
    }
};
