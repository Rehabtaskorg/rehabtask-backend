import { prisma } from "../config/prisma.js";
import { gcs } from "../config/gcs.js";
import { NotFoundError, BadRequestError, AuthorizationError } from "../utils/errors.js";
import { randomUUID } from "crypto";
import path from "path";
import {
    TIME_MS,
    APPROVAL_STATUS,
    THERAPIST_DOCUMENTS_BUCKET,
    AGENCY_DOCUMENTS_BUCKET,
    INDIVIDUAL_DOCUMENTS_BUCKET,
    PROFILE_IMAGES_BUCKET,
    DOCUMENT_CATEGORIES,
} from "../utils/constants.js";
import { logger } from "../config/logger.js";

const UPLOAD_RATE_LIMIT = 10;

const buildDocumentPath = (userId, folder, originalName) => {
    const timestamp = Date.now();
    const uniqueId = randomUUID();
    const sanitized = originalName.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 100);
    return `${userId}/${folder}/${timestamp}_${uniqueId}_${sanitized}`;
};

const saveToGcs = async (bucketName, filePath, file, cacheControl = "private, max-age=3600") => {
    await gcs.bucket(bucketName).file(filePath).save(file.buffer, {
        contentType: file.mimetype,
        resumable: false,
        metadata: { cacheControl },
    });
};

const checkUploadRateLimit = async (userId) => {
    const oneHourAgo = new Date(Date.now() - TIME_MS.ONE_HOUR);
    const recentUploads = await prisma.licenseDocument.count({
        where: { userId, uploadedAt: { gte: oneHourAgo }, isDeleted: false },
    });
    if (recentUploads >= UPLOAD_RATE_LIMIT) {
        throw new BadRequestError(
            `Upload rate limit exceeded. You can upload up to ${UPLOAD_RATE_LIMIT} documents per hour.`
        );
    }
};

const getProfilePhotoPublicUrl = (filePath) =>
    `https://storage.googleapis.com/${PROFILE_IMAGES_BUCKET}/${filePath}`;

/**
 * @param {{ userId: string, file: import("multer").File, category?: string, documentType: string, uploadIp?: string }} params
 */
export const uploadDocument = async ({ userId, file, category = "license", documentType, uploadIp = null }) => {
    const allowedTypes = DOCUMENT_CATEGORIES[category];
    if (!allowedTypes) throw new BadRequestError(`Unknown document category: ${category}`);
    if (!allowedTypes.includes(documentType)) {
        throw new BadRequestError(`Invalid documentType "${documentType}" for category "${category}"`);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { therapistProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");
    if (!user.therapistProfile) throw new NotFoundError("Therapist profile not found");

    const therapistId = user.therapistProfile.id;

    await checkUploadRateLimit(userId);

    const activeDocuments = await prisma.licenseDocument.count({
        where: { therapistId, documentType: { in: allowedTypes }, isDeleted: false },
    });
    if (activeDocuments >= 5) {
        throw new BadRequestError("Maximum of 5 active documents reached. Please delete an existing document before uploading.");
    }

    const filePath = buildDocumentPath(userId, category, file.originalname);
    await saveToGcs(THERAPIST_DOCUMENTS_BUCKET, filePath, file);

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
 * @param {{ userId: string, file: import("multer").File, documentType: string, uploadIp?: string }} params
 */
export const uploadAgencyDocument = async ({ userId, file, documentType, uploadIp = null }) => {
    const allowedTypes = [...DOCUMENT_CATEGORIES.agency, ...DOCUMENT_CATEGORIES.compliance];
    if (!allowedTypes.includes(documentType)) {
        throw new BadRequestError(`Invalid documentType "${documentType}" for agency uploads`);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");
    if (!user.customerProfile) throw new NotFoundError("Customer profile not found");

    if ([APPROVAL_STATUS.REVIEW, APPROVAL_STATUS.APPROVED].includes(user.customerProfile.approvalStatus)) {
        throw new AuthorizationError("Documents cannot be modified while your application is under review or approved");
    }

    const agencyId = user.customerProfile.id;

    await checkUploadRateLimit(userId);

    const activeDocuments = await prisma.licenseDocument.count({
        where: { agencyId, documentType: { in: allowedTypes }, isDeleted: false },
    });
    if (activeDocuments >= 10) {
        throw new BadRequestError("Maximum active agency documents reached. Please delete an existing document before uploading.");
    }

    const filePath = buildDocumentPath(userId, "agency", file.originalname);
    await saveToGcs(AGENCY_DOCUMENTS_BUCKET, filePath, file);

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
 * @param {{ userId: string, file: import("multer").File, documentType: string, uploadIp?: string }} params
 */
export const uploadIndividualDocument = async ({ userId, file, documentType, uploadIp = null }) => {
    const allowedTypes = DOCUMENT_CATEGORIES.individual;
    if (!allowedTypes.includes(documentType)) {
        throw new BadRequestError(`Invalid documentType "${documentType}" for individual uploads`);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");
    if (!user.customerProfile) throw new NotFoundError("Customer profile not found");

    if ([APPROVAL_STATUS.REVIEW, APPROVAL_STATUS.APPROVED].includes(user.customerProfile.approvalStatus)) {
        throw new AuthorizationError("Documents cannot be modified while your application is under review or approved");
    }

    const customerId = user.customerProfile.id;

    if (documentType === "therapy_order" && user.customerProfile.approvalStatus === APPROVAL_STATUS.REJECTED) {
        await prisma.licenseDocument.updateMany({
            where: { customerId, documentType: "therapy_order", isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
    }

    await checkUploadRateLimit(userId);

    const activeDocuments = await prisma.licenseDocument.count({
        where: { customerId, documentType, isDeleted: false },
    });
    if (activeDocuments >= 3) {
        throw new BadRequestError("Maximum active documents for this type reached. Please delete an existing document before uploading.");
    }

    const filePath = buildDocumentPath(userId, "individual", file.originalname);
    await saveToGcs(INDIVIDUAL_DOCUMENTS_BUCKET, filePath, file);

    const document = await prisma.licenseDocument.create({
        data: {
            customerId,
            userId,
            documentUrl: filePath,
            bucket: INDIVIDUAL_DOCUMENTS_BUCKET,
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
 * Uploads a therapist profile photo to the public-read profile-images bucket.
 * Returns a permanent public URL — no expiry since the bucket is public-read
 * and photos are served directly on the therapist marketplace.
 *
 * @param {{ userId: string, file: import("multer").File }} params
 * @returns {Promise<{ path: string, publicUrl: string, fileName: string, fileSize: number }>}
 */
export const uploadProfilePhoto = async ({ userId, file }) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");

    const fileExtension = path.extname(file.originalname);
    const filePath = `${userId}${fileExtension}`;

    await saveToGcs(PROFILE_IMAGES_BUCKET, filePath, file, "public, max-age=86400");

    return {
        path: filePath,
        publicUrl: getProfilePhotoPublicUrl(filePath),
        fileName: file.originalname,
        fileSize: file.size,
    };
};

/**
 * Best-effort storage cleanup — swallows errors so callers are not blocked
 * by a failed GCS delete on an otherwise successful operation.
 *
 * @param {string} bucket
 * @param {string} filePath
 */
export const deleteFileFromStorage = async (bucket, filePath) => {
    try {
        await gcs.bucket(bucket).file(filePath).delete();
    } catch (err) {
        if (err.code !== 404) {
            logger.error("Storage deletion error", { filePath, bucket, error: err.message });
        }
    }
};