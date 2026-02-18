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
            const validatedData = await schema.parseAsync(dataToValidate);
            req[source] = validatedData;
            next();
        } catch (error) {
            if (error.issues || error.name === "ZodError") {
                const formattedErrors = error.issues.map((err) => ({
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
                const dataToValidate = req[source];
                validatedData[source] = await schema.parseAsync(dataToValidate);
            }

            for (const [source, data] of Object.entries(validatedData)) {
                if (source === "body") {
                    req.body = data;
                } else {
                    Object.assign(req[source], data);
                }
            }

            next();
        } catch (error) {
            if (error.issues || error.name === "ZodError") {
                const formattedErrors = error.issues.map((err) => ({
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