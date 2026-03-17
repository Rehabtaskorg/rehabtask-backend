import { z } from "zod";

export const createReviewSchema = z.object({
    bookingId: z.string().uuid("Invalid booking ID"),
    rating: z
        .number()
        .int("Rating must be a whole number")
        .min(1, "Rating must be at least 1")
        .max(5, "Rating must be at most 5"),
    comment: z.string().max(2000, "Comment must be 2000 characters or less").optional(),
});