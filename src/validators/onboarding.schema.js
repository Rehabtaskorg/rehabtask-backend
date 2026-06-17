import { z } from "zod";

const US_STATE_CODES = [
    "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY",
];

const usPhoneSchema = z
    .string()
    .regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX");

export const personalInfoSchema = z.object({
    dateOfBirth: z
        .string()
        .date("Date of birth must be a valid date (YYYY-MM-DD)")
        .refine((val) => {
            const dob = new Date(val);
            const now = new Date();
            const age = now.getFullYear() - dob.getFullYear();
            return age >= 18 && age <= 100;
        }, { message: "Therapist must be between 18 and 100 years old" }),

    phone: usPhoneSchema,

    addressLine1: z.string().min(1, "Address is required").max(255),
    addressLine2: z.string().max(255).optional().nullable(),
    city: z.string().min(1, "City is required").max(100),
    state: z
        .string()
        .length(2, "State must be a 2-letter code")
        .refine((val) => US_STATE_CODES.includes(val.toUpperCase()), {
            message: "Please provide a valid US state",
        })
        .transform((val) => val.toUpperCase()),
    zipCode: z
        .string()
        .regex(/^\d{5}$/, "ZIP code must be exactly 5 digits"),

    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),

    emergencyContactName: z.string().max(255).optional().nullable(),
    emergencyContactPhone: usPhoneSchema.optional().nullable(),
});

export const professionalProfileSchema = z.object({
    yearsOfExperience: z
        .number()
        .int()
        .min(0, "Years of experience must be 0 or greater")
        .max(50, "Years of experience seems invalid"),

    primaryLicenseType: z
        .string()
        .min(1, "Primary license type is required")
        .max(100, "License type too long"),

    specialization: z
        .string()
        .max(500, "Specialization too long")
        .optional()
        .nullable(),

    professionalSummary: z
        .string()
        .min(100, "Professional summary must be at least 100 characters")
        .max(2000, "Professional summary must not exceed 2000 characters"),

    profilePhotoUrl: z
        .url("Invalid profile photo URL")
        .optional()
        .nullable(),
})

export const credentialsSchema = z.object({
    licenseNumber: z
        .string()
        .min(3, "License number must be at least 3 characters")
        .max(100, "License number too long"),

    licenseState: z
        .string()
        .length(2, "License state must be 2-letter code")
        .regex(/^[A-Z]{2}$/, "Invalid state code"),

    npiNumber: z
        .string()
        .regex(/^\d{10}$/, "NPI must be exactly 10 digits")
        .or(z.literal(""))
        .optional()
        .nullable(),

    additionalLicenseStates: z
        .array(
            z.string()
                .length(2, "State code must be 2 letters")
                .refine((val) => US_STATE_CODES.includes(val.toUpperCase()), {
                    message: "Invalid US state code",
                })
        )
        .max(50, "Too many states selected")
        .optional()
        .default([]),

    licenseDocuments: z
        .array(z.object({
            path: z.string(),
            fileName: z.string(),
            fileSize: z.number(),
            documentType: z.string(),
            mimeType: z.string().optional(),
        }))
        .min(1, "At least one license document is required")
        .max(5, "Maximum 5 license documents allowed"),

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
        .optional()
        .transform(val => (val === 0 ? null : val)),
}).refine(
    (data) => {
        // Cap: attempted rate cannot exceed session rate when both are set.
        if (data.attemptedVisitRate == null || data.ratePerVisit == null) return true;
        return data.attemptedVisitRate <= data.ratePerVisit;
    },
    {
        message: "Attempted visit rate cannot be greater than your session rate",
        path: ["attemptedVisitRate"],
    }
)

// Availability Schema
const timeBlockSchema = z.object({
    startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
    endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
}).refine(block => block.endTime > block.startTime, {
    error: "End time must be after start time",
    path: ["endTime"],
});

const daySchema = z.object({
    enabled: z.boolean(),
    timeBlocks: z.array(timeBlockSchema),
}).superRefine((day, ctx) => {
    if (day.enabled && day.timeBlocks.length === 0) {
        ctx.addIssue({
            code: "custom",
            message: "Enabled days must have at least one time block",
            path: ["timeBlocks"],
        });
    }
});

// WorkArea sub-schema for geocoded ZIP code data from frontend
const workAreaSchema = z.object({
    zipCode: z.string().regex(/^\d{5}$/, "ZIP code must be 5 digits").or(z.literal("")).optional().default(""),
    city: z.string().min(1, "City is required").max(100, "City name too long"),
    state: z.string().min(1, "State is required").max(50, "State name too long"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMiles: z.number().int().min(1).max(100).default(25),
});

export const availabilitySchema = z.object({
    schedule: z.object({
        monday: daySchema,
        tuesday: daySchema,
        wednesday: daySchema,
        thursday: daySchema,
        friday: daySchema,
        saturday: daySchema,
        sunday: daySchema,
    }).refine(schedule => Object.values(schedule).some(day => day.enabled), {
        error: "At least one day must be enabled",
    }),

    acceptingNewPatients: z.boolean().optional().default(true),

    workAreas: z.array(workAreaSchema).min(1, "At least one work area is required"),
})

export const backgroundCheckSchema = z.object({
    consent: z
        .boolean()
        .refine(val => val === true, {
            error: "Consent is required to proceed",
        }),

    signature: z
        .string()
        .min(2, "Signature is required")
        .max(255, "Signature too long"),
});