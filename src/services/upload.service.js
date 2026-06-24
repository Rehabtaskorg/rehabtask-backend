import { prisma } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";
import { randomUUID } from "crypto";
import path from "path";
import { TIME_MS, APPROVAL_STATUS, THERAPIST_DOCUMENTS_BUCKET, AGENCY_DOCUMENTS_BUCKET, DOCUMENT_CATEGORIES } from "../utils/constants.js";
import { logger } from "../config/logger.js";

/**
 * Upload a therapist onboarding document (license, insurance, identity,
 * compliance, ...) to the shared therapist-documents bucket and create its
 * DB record. One function for every category — category only decides which
 * documentType values are accepted; storage location and DB shape are the same.
 */
export const uploadDocument = async ({ userId, file, category = "license", documentType, uploadIp = null }) => {
    const allowedTypes = DOCUMENT_CATEGORIES[category];
    if (!allowedTypes) {
        throw new BadRequestError(`Unknown document category: ${category}`);
    }
    if (!allowedTypes.includes(documentType)) {
        throw new BadRequestError(`Invalid documentType "${documentType}" for category "${category}"`);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            therapistProfile: true
        }
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (!user.therapistProfile) {
        throw new NotFoundError("Therapist profile not found");
    }

    const therapistId = user.therapistProfile.id;

    // Check rate limit: Max 10 uploads per hour
    const oneHourAgo = new Date(Date.now() - TIME_MS.ONE_HOUR);
    const recentUploads = await prisma.licenseDocument.count({
        where: {
            userId,
            uploadedAt: { gte: oneHourAgo },
            isDeleted: false
        }
    });

    if (recentUploads >= 10) {
        throw new BadRequestError(
            "Upload rate limit exceeded. You can upload up to 10 documents per hour."
        );
    }

    const activeDocuments = await prisma.licenseDocument.count({
        where: {
            therapistId,
            documentType: { in: allowedTypes },
            isDeleted: false
        }
    });

    if (activeDocuments >= 5) {
        throw new BadRequestError(
            "Maximum of 5 active documents reached. Please delete an existing document before uploading."
        );
    }

    const timestamp = Date.now();
    const uniqueId = randomUUID();
    const sanitizedFileName = file.originalname
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .substring(0, 100);

    // Path structure: userId/category/timestamp_uniqueId_filename
    const filePath = `${userId}/${category}/${timestamp}_${uniqueId}_${sanitizedFileName}`;

    // Upload to Supabase using service role (bypasses RLS)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(THERAPIST_DOCUMENTS_BUCKET)
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false, // Don't overwrite if exists
            cacheControl: "3600"
        });

    if (uploadError) {
        logger.error("Supabase upload error", { error: uploadError.message });
        throw new BadRequestError(
            `Failed to upload file: ${uploadError.message}`
        );
    }

    // Create DB record
    const document = await prisma.licenseDocument.create({
        data: {
            therapistId,
            userId,
            documentUrl: filePath,
            bucket: THERAPIST_DOCUMENTS_BUCKET,
            documentType,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            status: APPROVAL_STATUS.PENDING,
            uploadIp,
            isDeleted: false
        }
    });

    // Return metadata (no public URL for private documents)
    return {
        id: document.id,
        path: filePath,
        fileName: document.fileName,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        documentType: document.documentType,
        status: document.status,
        uploadedAt: document.uploadedAt
    };
};

/**
 * Upload an agency onboarding document to the agency-documents bucket.
 * Mirrors uploadDocument but scoped to CustomerProfile (agencyId FK).
 */
export const uploadAgencyDocument = async ({ userId, file, documentType, uploadIp = null }) => {
    const allowedTypes = DOCUMENT_CATEGORIES.agency;
    if (!allowedTypes.includes(documentType)) {
        throw new BadRequestError(`Invalid documentType "${documentType}" for agency uploads`);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true },
    });

    if (!user) throw new NotFoundError("User not found");
    if (!user.customerProfile) throw new NotFoundError("Customer profile not found");

    const agencyId = user.customerProfile.id;

    const oneHourAgo = new Date(Date.now() - TIME_MS.ONE_HOUR);
    const recentUploads = await prisma.licenseDocument.count({
        where: { userId, uploadedAt: { gte: oneHourAgo }, isDeleted: false },
    });

    if (recentUploads >= 10) {
        throw new BadRequestError("Upload rate limit exceeded. You can upload up to 10 documents per hour.");
    }

    const activeDocuments = await prisma.licenseDocument.count({
        where: { agencyId, documentType: { in: allowedTypes }, isDeleted: false },
    });

    if (activeDocuments >= 10) {
        throw new BadRequestError("Maximum active agency documents reached. Please delete an existing document before uploading.");
    }

    const timestamp = Date.now();
    const uniqueId = randomUUID();
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 100);
    const filePath = `${userId}/agency/${timestamp}_${uniqueId}_${sanitizedFileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
        .from(AGENCY_DOCUMENTS_BUCKET)
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
            cacheControl: "3600",
        });

    if (uploadError) {
        logger.error("Supabase agency upload error", { error: uploadError.message });
        throw new BadRequestError(`Failed to upload file: ${uploadError.message}`);
    }

    const document = await prisma.licenseDocument.create({
        data: {
            agencyId,
            userId,
            documentUrl: filePath,
            bucket: AGENCY_DOCUMENTS_BUCKET,
            documentType,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            status: APPROVAL_STATUS.PENDING,
            uploadIp,
            isDeleted: false,
        },
    });

    return {
        id: document.id,
        path: filePath,
        fileName: document.fileName,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        documentType: document.documentType,
        status: document.status,
        uploadedAt: document.uploadedAt,
    };
};

/**
 * Upload profile photo to Supabase storage
 * Uses service role to bypass RLS policies
 */
export const uploadProfilePhoto = async ({ userId, file }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId }
    });

    if (!user) {
        throw new NotFoundError("User not found");
    }

    const fileExtension = path.extname(file.originalname);
    const fileName = `${userId}${fileExtension}`;

    // Upload to Supabase using service role
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from("profile-images")
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true,
            cacheControl: "3600"
        });

    if (uploadError) {
        logger.error("Supabase upload error", { error: uploadError.message });
        throw new BadRequestError(
            `Failed to upload file: ${uploadError.message}`
        );
    }

    // Get public URL (profile-images is a public bucket)
    const { data: { publicUrl } } = supabaseAdmin.storage
        .from("profile-images")
        .getPublicUrl(fileName);

    return {
        path: fileName,
        publicUrl,
        fileName: file.originalname,
        fileSize: file.size
    };
}

/**
 * Delete a file from Supabase Storage. Used both for upload-error cleanup
 * and for permanently removing a document's storage object when a user
 * explicitly removes it. Swallows errors — callers treat storage cleanup
 * as best-effort and should not fail the calling operation because of it.
 *
 * @param {string} bucket - Bucket name
 * @param {string} filePath - File path in bucket
 */
export const deleteFileFromStorage = async (bucket, filePath) => {
    try {
        const { error } = await supabaseAdmin.storage
            .from(bucket)
            .remove([filePath]);

        if (error) {
            logger.error(`Failed to delete file from storage`, { filePath, bucket, error: error.message });
        }
    } catch (error) {
        logger.error("Storage deletion error", { filePath, bucket, error: error.message });
    }
}