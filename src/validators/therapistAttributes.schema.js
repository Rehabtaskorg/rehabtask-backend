import { z } from "zod";
import {
    THERAPIST_SPECIALTIES,
    THERAPIST_LANGUAGES,
    THERAPIST_CERTIFICATIONS,
    THERAPIST_PAST_SETTINGS,
    THERAPIST_POPULATIONS,
} from "../utils/constants.js";

const MAX_PER_CATEGORY = 20;

const allowed = (options, label) =>
    z
        .array(
            z.string().refine((value) => options.includes(value), {
                message: `Not a recognised ${label}`,
            })
        )
        .max(MAX_PER_CATEGORY, `Select ${MAX_PER_CATEGORY} or fewer`);

export const THERAPIST_ATTRIBUTE_FIELDS = {
    specialties: allowed(THERAPIST_SPECIALTIES, "specialty")
        .min(1, "At least one specialty is required"),
    languages: allowed(THERAPIST_LANGUAGES, "language").optional().default([]),
    certifications: allowed(THERAPIST_CERTIFICATIONS, "certification").optional().default([]),
    pastSettings: allowed(THERAPIST_PAST_SETTINGS, "clinical setting").optional().default([]),
    populationExperience: allowed(THERAPIST_POPULATIONS, "population").optional().default([]),
};

export const updateAttributesSchema = z.object(THERAPIST_ATTRIBUTE_FIELDS);
