import { gcs } from "../config/gcs.js";
import { BadRequestError } from "../utils/errors.js";
import { randomUUID } from "crypto";
import path from "path";

/**
 * @param {{ file: import("multer").File, bucket: string, folder: string, prefix?: string }} params
 * @returns {Promise<{ path: string, fileName: string, fileSize: number }>}
 */
export const uploadFileToStorage = async ({ file, bucket, folder, prefix = "" }) => {
    const fileExtension = path.extname(file.originalname);
    const timestamp = Date.now();
    const uniqueId = randomUUID();
    const sanitizedFileName = file.originalname
        .replace(/[^a-zA-Z0-9.-]/g, "_")
        .substring(0, 100);

    const fileName = prefix
        ? `${prefix}_${timestamp}_${uniqueId}${fileExtension}`
        : `${timestamp}_${uniqueId}_${sanitizedFileName}`;

    const filePath = `${folder}/${fileName}`;

    const gcsFile = gcs.bucket(bucket).file(filePath);

    await gcsFile.save(file.buffer, {
        contentType: file.mimetype,
        resumable: false,
        metadata: { cacheControl: "private, max-age=3600" },
    });

    return {
        path: filePath,
        fileName: file.originalname,
        fileSize: file.size,
    };
};

/**
 * @param {string} bucket
 * @param {string} filePath
 * @returns {Promise<{ success: true }>}
 */
export const deleteFileFromStorage = async (bucket, filePath) => {
    try {
        await gcs.bucket(bucket).file(filePath).delete();
        return { success: true };
    } catch (err) {
        if (err.code === 404) return { success: true };
        throw new BadRequestError(`Delete failed: ${err.message}`);
    }
};

/**
 * @param {string} bucket
 * @param {string} filePath
 * @param {number} [expiresIn=60]
 * @returns {Promise<{ signedUrl: string, expiresIn: number }>}
 */
export const getSignedUrl = async (bucket, filePath, expiresIn = 60) => {
    const [url] = await gcs.bucket(bucket).file(filePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresIn * 1000,
    });

    return { signedUrl: url, expiresIn };
};
