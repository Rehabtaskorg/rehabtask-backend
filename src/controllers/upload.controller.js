import { uploadDocument, uploadProfilePhoto } from "../services/upload.service.js";
import { BadRequestError } from "../utils/errors.js";

/**
 * Get client IP address from the request
 */
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        null;
};

/**
 * POST /api/therapist/onboarding/upload-document
 * Upload an onboarding document via backend (server-side Supabase upload).
 * Shared across all document-bearing onboarding steps — category + documentType
 * in the request body decide which step the document belongs to.
 */
export const uploadDocumentController = async (req, res, next) => {
    try {
        if (!req.file) {
            throw new BadRequestError("No file uploaded");
        }

        const file = req.file;
        const uploadIp = getClientIp(req);
        const userId = req.user.id;
        const category = req.body.category || "license";
        const documentType = req.body.documentType || "license";

        const result = await uploadDocument({
            userId,
            file,
            category,
            documentType,
            uploadIp
        });

        res.status(201).json({
            success: true,
            message: "Document uploaded successfully",
            data: result
        });

    } catch (error) {
        // If error occurs after file is in memory, ensure cleanup
        if (req.file) {
            req.file.buffer = null;
        }
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/upload-profile-photo
 * Upload profile photo via backend
 */
export const uploadProfilePhotoController = async (req, res, next) => {
    try {
        if (!req.file) {
            throw new BadRequestError("No file uploaded");
        }

        const file = req.file;
        const userId = req.user.id;

        // Validate file type (images only)
        const allowedMimeTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestError(
                "Invalid file type. Only JPEG, PNG, and WebP images are allowed."
            );
        }

        const maxSize = 5 * 1024 * 1024; // 5MB
        if (file.size > maxSize) {
            throw new BadRequestError(
                "Image too large. Maximum size is 5MB."
            );
        }

        const result = await uploadProfilePhoto({ userId, file });

        res.status(201).json({
            success: true,
            message: "Profile photo uploaded successfully",
            data: {
                url: result.publicUrl,
                path: result.path
            }
        });

    } catch (error) {
        if (req.file) {
            req.file.buffer = null;
        }
        next(error);
    }
}