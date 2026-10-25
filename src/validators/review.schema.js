import { z } from "zod";

const categoryRating = (label) =>
    z
        .number()
        .int(`${label} rating must be a whole number`)
        .min(1, `${label} rating must be at least 1`)
        .max(5, `${label} rating must be at most 5`);

export const createReviewSchema = z.object({
    bookingId: z.string().uuid("Invalid booking ID"),
    communicationRating: categoryRating("Communication"),
    documentationRating: categoryRating("Timely documentation"),
    professionalismRating: categoryRating("Professionalism"),
    comment: z.string().max(2000, "Comment must be 2000 characters or less").optional(),
});
