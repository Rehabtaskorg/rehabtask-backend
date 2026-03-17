import multer from "multer";
import { BadRequestError } from "../utils/errors.js";

/**
 * Multer configuration for handling file uploads
 * Uses memory storage to keep files in buffer for direct upload to Supabase
 */

// Memory storage - files stores as Buffer in memory
const storage = multer.memoryStorage();

/**
 * File filter to validate file types
 * @param {Object} req - Express request
 * @param {Object} file - Multer file object
 * @param {Function} cb - Callback
 */
const fileFilter = (req, file, cb) => {
    // Allowed MIME types for license documents
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new BadRequestError(
            "Invalid file type. Only PDF, JPEG, and PNG files are allowed."
        ), false);
    }

}

/**
 * File filter for profile images only
 */
const imageFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new BadRequestError(
            "Invalid file type. Only JPEG, PNG, and WebP images are allowed."
        ), false);
    }
}

/**
 * Multer instance for license documents 
 * - Single file upload
 * - Max size: 20MB
 * - Allowed: PDF, JPEG, PNG
 */
export const uploadDocument = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB
        files: 1
    }
}).single("file");

/**
 * Multer instance for profile images
 * - Single file upload
 * - Max size: 5MB
 * - Allowed: JPEG, PNG, WebP
 */
export const uploadImage = multer({
    storage,
    fileFilter: imageFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 1
    }
}).single('file');

/**
 * Error handler for multer errors
 * Use this in routes after multer middleware
 */
export const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return next(new BadRequestError('File too large. Maximum size exceeded.'));
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return next(new BadRequestError('Unexpected field name. Use "file" as field name.'));
        }
        return next(new BadRequestError(`Upload error: ${err.message}`));
    }
    next(err);
}