import { prisma } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";
import { randomUUID } from "crypto";
import path from "path";
import { TIME_MS, APPROVAL_STATUS } from "../utils/constants.js";

/**
 * Upload license document to Supabase storage and create database record
 * Uses service role to bypass RLS policies
 */
export const uploadLicenseDocument = async ({ userId, file, documentType = "license", uploadIp = null }) => {
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

    // Path structure: userId/timestamp_uniqueId_filename
    const filePath = `${userId}/${timestamp}_${uniqueId}_${sanitizedFileName}`;

    // Upload to Supabase using service role (bypasses RLS)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from("license-documents")
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false, // Don't overwrite if exists
            cacheControl: "3600"
        });

    if (uploadError) {
        console.error("Supabase upload error:", uploadError);
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
            bucket: "license-documents",
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
        console.error("Supabase upload error:", uploadError);
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
 * Delete file from Supabase storage
 * Only used for cleanup in error scenarios
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
            console.error(`Failed to delete file ${filePath} from ${bucket}:`, error);
        }
    } catch (error) {
        console.error("Storage deletion error:", error);
    }
}