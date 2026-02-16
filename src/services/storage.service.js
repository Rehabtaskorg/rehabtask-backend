import { supabaseAdmin } from "../config/supabase.js";
import { BadRequestError } from "../utils/errors.js";
import { randomUUID } from "crypto";
import path from "path";

/**
 * Upload file to Supabase storage using service role
 * Generic upload function for any bucket
 * 
 * @param {Object} params
 * @param {Object} params.file - Multer file object with buffer
 * @param {string} params.bucket - Storage bucket name
 * @param {string} params.folder - Folder path (usually userId)
 * @param {string} params.prefix - File prefix (e.g., 'profile', 'license')
 * @returns {Promise<Object>} Upload result with path and URL
 */
export const uploadFileToStorage = async ({ file, bucket, folder, prefix = "" }) => {
    try {
        // Generate unique filename
        const fileExtension = path.extname(file.originalname);
        const timestamp = Date.now();
        const uniqueId = randomUUID();
        const sanitizedFileName = file.originalname
            .replace(/[^a-zA-Z0-9.-]/g, '_')
            .substring(0, 100);

        // Construct file path
        const fileName = prefix
            ? `${prefix}_${timestamp}_${uniqueId}${fileExtension}`
            : `${timestamp}_${uniqueId}_${sanitizedFileName}`;

        const filePath = `${folder}/${fileName}`;

        // Upload to Supabase
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
                cacheControl: '3600'
            });

        if (error) {
            console.error("Supabase storage upload error:", error);
            throw new BadRequestError(`Upload failed: ${error.message}`);
        }

        // Get public URL (for public buckets like profile-images)
        const { data: { publicUrl } } = supabaseAdmin.storage
            .from(bucket)
            .getPublicUrl(filePath);

        return {
            path: filePath,
            publicUrl,
            fileName: file.originalname,
            fileSize: file.size
        }
    } catch (error) {
        console.error("Storage upload error:", error);
        throw error;
    }
}

/**
 * Delete file from storage
 * 
 * @param {string} bucket - Bucket name
 * @param {string} filePath - File path to delete
 */
export const deleteFileFromStorage = async (bucket, filePath) => {
    try {
        const { error } = await supabaseAdmin.storage
            .from(bucket)
            .remove([filePath]);

        if (error) {
            console.error(`Failed to delete ${filePath} from ${bucket}:`, error);
            throw new BadRequestError(`Delete failed: ${error.message}`);
        }

        return { success: true };
    } catch (error) {
        console.error("Storage deletion error:", error);
        throw error;
    }
};

/**
 * Generate signed URL for private files
 * 
 * @param {string} bucket - Bucket name
 * @param {string} filePath - File path
 * @param {number} expiresIn - Expiry in seconds (default 60)
 * @returns {Promise<Object>} Signed URL data
 */
export const getSignedUrl = async (bucket, filePath, expiresIn = 60) => {
    try {
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(filePath, expiresIn);

        if (error) {
            console.error("Failed to generate signed URL:", error);
            throw new BadRequestError(`Failed to generate URL: ${error.message}`);
        }

        return {
            signedUrl: data.signedUrl,
            expiresIn
        };
    } catch (error) {
        console.error("Signed URL error:", error);
        throw error;
    }
};