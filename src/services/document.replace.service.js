import { prisma } from "../config/prisma.js";
import { APPROVAL_STATUS, THERAPIST_DOCUMENTS_BUCKET, AGENCY_DOCUMENTS_BUCKET, INDIVIDUAL_DOCUMENTS_BUCKET } from "../utils/constants.js";
import { NotFoundError, BadRequestError, AuthorizationError } from "../utils/errors.js";
import { logAction } from "./audit.service.js";
import { logger } from "../config/logger.js";
import { saveToGcs, buildDocumentPath, checkUploadRateLimit } from "./upload.service.js";

const REPLACE_ALLOWED_STATUSES = [APPROVAL_STATUS.REVIEW, APPROVAL_STATUS.APPROVED];

const assertReplaceAllowed = (profile) => {
    if (!REPLACE_ALLOWED_STATUSES.includes(profile?.approvalStatus)) {
        throw new AuthorizationError(
            "Document replacement is only available once your application has been submitted. Use the onboarding wizard to manage documents."
        );
    }
};

export const replaceDocument = async ({ userId, documentId, file, uploadIp = null }) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            therapistProfile: { select: { id: true, approvalStatus: true } },
            customerProfile: { select: { id: true, approvalStatus: true, customerType: true } },
        },
    });
    if (!user) throw new NotFoundError("User not found");

    const isTherapist = !!user.therapistProfile;
    const profile = user.therapistProfile ?? user.customerProfile;
    if (!profile) throw new NotFoundError("Profile not found");

    assertReplaceAllowed(profile);

    const existing = await prisma.licenseDocument.findUnique({ where: { id: documentId } });
    if (!existing) throw new NotFoundError("Document not found");
    if (existing.isDeleted) throw new BadRequestError("Document already deleted");

    const ownsDocument = isTherapist
        ? existing.therapistId === profile.id
        : (existing.agencyId === profile.id || existing.customerId === profile.id);
    if (!ownsDocument) throw new BadRequestError("Not authorized to replace this document");

    await checkUploadRateLimit(userId);

    const bucket = isTherapist
        ? THERAPIST_DOCUMENTS_BUCKET
        : existing.agencyId
            ? AGENCY_DOCUMENTS_BUCKET
            : INDIVIDUAL_DOCUMENTS_BUCKET;

    const category = isTherapist ? "license" : existing.agencyId ? "agency" : "individual";
    const filePath = buildDocumentPath(userId, category, file.originalname);
    await saveToGcs(bucket, filePath, file);

    const ownerLink = isTherapist
        ? { therapistId: profile.id }
        : existing.agencyId
            ? { agencyId: profile.id }
            : { customerId: profile.id };

    const isApproved = profile.approvalStatus === APPROVAL_STATUS.APPROVED;

    const created = await prisma.$transaction(async (tx) => {
        await tx.licenseDocument.update({
            where: { id: documentId },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        const doc = await tx.licenseDocument.create({
            data: {
                ...ownerLink,
                userId,
                documentUrl: filePath,
                bucket,
                documentType: existing.documentType,
                fileName: file.originalname,
                mimeType: file.mimetype,
                fileSize: file.size,
                status: APPROVAL_STATUS.PENDING,
                uploadIp,
                isDeleted: false,
                supersedesId: existing.id,
            },
        });

        if (isApproved) {
            const model = isTherapist ? tx.therapistProfile : tx.customerProfile;
            await model.update({
                where: { id: profile.id },
                data: { pendingReviewAt: new Date() },
            });
        }

        return doc;
    });

    logAction({
        actorId: userId,
        action: "document.replaced",
        entityType: "license_document",
        entityId: created.id,
        changes: { documentType: existing.documentType, supersedesId: existing.id, duringStatus: profile.approvalStatus },
    }).catch((err) => logger.error("[ReplaceDocument] audit failed", { error: err.message }));

    return {
        id: created.id,
        path: filePath,
        fileName: created.fileName,
        fileSize: created.fileSize,
        mimeType: created.mimeType,
        documentType: created.documentType,
        status: created.status,
        supersedesId: created.supersedesId,
        uploadedAt: created.uploadedAt,
    };
};
