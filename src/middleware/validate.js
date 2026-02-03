import { ValidationError } from "../utils/errors.js";

/**
 * Middleware to validate request data against Zod schema
 * 
 * @param {Object} schema - Zod schema to validate against
 * @param {String} source - Source of data to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export const validate = (schema, source = "body") => {
    return async (req, res, next) => {
        try {
            const dataToValidate = req[source];

            // Parse and validate data
            const validatedData = await schema.parseAsync(dataToValidate);

            // Replace request data with validated (and potentially transformed) data
            req[source] = validatedData;

            next();
        } catch (error) {
            if (error.name === "ZodError") {
                // Format Zod errors for better readability
                const formattedErrors = error.error.map((err) => ({
                    field: err.path.join("."),
                    message: err.message,
                }));

                next(new ValidationError("Validation failed", formattedErrors));
            } else {
                next(error);
            }
        }
    };
};

/**
 * Middleware to validate multiple sources
 * 
 * @param {Object} schemas - Object with keys as sources and values as Zod schemas
 * @returns {Function} Express middleware function
 */
export const validateMultiple = (schemas) => {
    return async (req, res, next) => {
        try {
            const validatedData = {};

            for (const [source, schema] of Object.entries(schemas)) {
                if (req[source]) {
                    validatedData[source] = await schema.parseAsync(req[source]);
                    req[source] = validatedData[source];
                }
            }

            next();
        } catch (error) {
            if (error.name === "ZodError") {
                const formattedErrors = error.errors.map((err) => ({
                    field: err.path.join("."),
                    message: err.message,
                }));

                next(new ValidationError("Validation failed", formattedErrors));
            } else {
                next(error);
            }
        }
    }
}