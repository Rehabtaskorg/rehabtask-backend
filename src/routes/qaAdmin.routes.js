import express from "express";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";

const router = express.Router();

// Static password middleware - no middleware no supabase auth
const qaPasswordAuth = (req, res, next) => {
    const password = req.headers["x-qa-password"];
    const expected = process.env.QA_ADMIN_PASSWORD || "password";

    if (!password || password !== expected) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            message: "Invalid or missing QA admin password",
        });
    }
    next();
};

router.use(qaPasswordAuth);

/**
 * GET /qa-admin/therapists — List all therapists
 */
router.get("/therapists", async (req, res, next) => {
    try {
        const therapists = await prisma.therapistProfile.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                fullName: true,
                phone: true,
                specialization: true,
                approvalStatus: true,
                onboardingStep: true,
                onboardingComplete: true,
                stripeOnboardingComplete: true,
                profilePhotoUrl: true,
                createdAt: true,
                rejectionReason: true,
                user: {
                    select: { email: true },
                },
            },
            include: undefined,
        });

        res.status(200).json({ success: true, data: therapists });
    } catch (error) {
        next(error);
    }
})

/**
 * PUT /qa-admin/therapists/:id/approve
 */
router.put("/therapists/:id/approve", async (req, res, next) => {
    try {
        const { id } = req.params;

        const therapist = await prisma.therapistProfile.findUnique({
            where: { id },
        });

        if (!therapist) {
            throw new NotFoundError("Therapist not found");
        }

        const updated = await withAdminAccess(async (tx) => {
            return tx.therapistProfile.update({
                where: { id },
                data: {
                    approvalStatus: "approved",
                    approvedAt: new Date(),
                },
            });
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
})

/**
 * PUT /qa-admin/therapists/:id/reject
 */
router.put("/therapists/:id/reject", async (req, res, next) => {
    try {
        const { id } = req.params;

        const therapist = await prisma.therapistProfile.findUnique({
            where: { id },
        });

        if (!therapist) {
            throw new NotFoundError("Therapist not found");
        }

        const updated = await withAdminAccess(async (tx) => {
            return tx.therapistProfile.update({
                where: { id },
                data: {
                    approvalStatus: "rejected",
                    rejectionReason: req.body.rejectionReason || null,
                },
            });
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

export default router;