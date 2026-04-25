import { z } from "zod";

export const updateProfileSchema = z.object({
    fullName: z
        .string()
        .min(2, "Full name must be at least 2 characters")
        .max(255, "Full name must be 255 characters or less")
        .optional(),
    phone: z
        .string()
        .regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX")
        .optional(),
    professionalSummary: z
        .string()
        .min(100, "Professional summary must be at least 100 characters")
        .max(2000, "Professional summary must be 2000 characters or less")
        .optional(),
    specialization: z
        .string()
        .max(500, "Specialization must be 500 characters or less")
        .optional()
        .nullable(),
    profilePhotoUrl: z.string().url("Invalid URL format").nullable().optional(),
    ratePerVisit: z.coerce
        .number()
        .min(0, "Rate must be 0 or greater")
        .max(10000, "Rate must be $10,000 or less")
        .nullable()
        .optional()
        .transform(val => val === 0 ? null : val),
    attemptedVisitRate: z.coerce
        .number()
        .min(0, "Attempted visit rate must be 0 or greater")
        .max(10000, "Attempted visit rate must be $10,000 or less")
        .nullable()
        .optional(),
    yearsOfExperience: z.coerce
        .number()
        .int()
        .min(0, "Must be 0 or greater")
        .max(50, "Must be 50 or less")
        .optional(),
});

export const updateWorkAreasSchema = z.object({
    workAreas: z
        .array(
            z.object({
                zipCode: z
                    .string()
                    .regex(/^\d{5}$/, "ZIP code must be 5 digits"),
                city: z
                    .string()
                    .min(1, "City is required")
                    .max(100, "City must be 100 characters or less"),
                state: z
                    .string()
                    .min(1, "State is required")
                    .max(50, "State must be 50 characters or less"),
                latitude: z.number().min(-90).max(90, "Latitude must be between -90 and 90"),
                longitude: z.number().min(-180).max(180, "Longitude must be between -180 and 180"),
                radiusMiles: z
                    .number()
                    .int("Radius must be a whole number")
                    .min(1, "Radius must be at least 1 mile")
                    .max(100, "Radius must be 100 miles or less")
                    .optional()
                    .default(25),
            })
        )
        .min(0),
});

export const updateAvailabilitySchema = z.object({
    schedule: z.record(
        z.enum([
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]),
        z.object({
            enabled: z.boolean(),
            timeBlocks: z.array(
                z.object({
                    startTime: z.string(),
                    endTime: z.string(),
                })
            ),
        })
    ),
});

export const searchTherapistsSchema = z.object({
    search: z.string().trim().max(100).optional(),
    latitude: z
        .string()
        .transform((val) => parseFloat(val))
        .pipe(z.number().min(-90).max(90))
        .optional(),
    longitude: z
        .string()
        .transform((val) => parseFloat(val))
        .pipe(z.number().min(-180).max(180))
        .optional(),
    radiusMiles: z
        .string()
        .optional()
        .default("50")
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1).max(500)),
    specialization: z.string().max(500).optional(),
    primaryLicenseType: z.string().max(500).optional(),
    sortBy: z.enum(["relevance", "rating", "experience", "newest"]).optional(),
    page: z
        .string()
        .optional()
        .default("1")
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1)),
    limit: z
        .string()
        .optional()
        .default("20")
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1).max(50)),
});

export const therapistIdParamSchema = z.object({
    therapistId: z.uuid("Invalid therapist ID"),
});

export const reviewsPaginationSchema = z.object({
    page: z
        .string()
        .optional()
        .default("1")
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1)),
    limit: z
        .string()
        .optional()
        .default("10")
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1).max(50)),
})