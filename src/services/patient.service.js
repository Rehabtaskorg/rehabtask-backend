import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * Validate that the customer is an agency type
 */
const requireAgency = (customerProfile) => {
    if (customerProfile.customerType !== "agency") {
        const err = new Error("Only agency accounts can manage patients");
        err.statusCode = 403;
        throw err;
    }
};

/**
 * Get all active patients for an agency
 */
export const getAgencyPatients = async (customerProfile) => {
    requireAgency(customerProfile);

    const patients = await prisma.patient.findMany({
        where: {
            agencyId: customerProfile.id,
            isActive: true,
        },
        include: {
            requestsForPatient: {
                select: { id: true, status: true, serviceType: true, createdAt: true },
                orderBy: { createdAt: "desc" },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return patients;
};

/**
 * Create a new patient under the agency
 */
export const createPatient = async (customerProfile, data) => {
    requireAgency(customerProfile);

    const {
        fullName, email, phone,
        addressLine1, addressLine2, city, state, zipCode,
        latitude, longitude,
    } = data;

    const patient = await prisma.patient.create({
        data: {
            agencyId: customerProfile.id,
            fullName,
            email: email || null,
            phone: phone || null,
            addressLine1: addressLine1 || null,
            addressLine2: addressLine2 || null,
            city: city || null,
            state: state || null,
            zipCode: zipCode || null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            isActive: true,
        },
    });

    return patient;
};

/**
 * Get a single patient with their full history
 */
export const getPatientById = async (customerProfile, patientId) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: {
            id: patientId,
            agencyId: customerProfile.id
        },
        include: {
            requestsForPatient: {
                select: {
                    id: true,
                    serviceType: true,
                    status: true,
                    preferredDate: true,
                    location: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "desc" },
            },
            bookingsForPatient: {
                select: {
                    id: true,
                    scheduledDate: true,
                    status: true,
                    rate: true,
                    sessionType: true,
                    therapist: {
                        select: { fullName: true, profilePhotoUrl: true }
                    },
                },
                orderBy: { scheduledDate: "desc" },
            },
        },
    });

    if (!patient) {
        throw new NotFoundError("Patient not found");
    }

    return patient;
}

/**
 * Update patient info
 */
export const updatePatient = async (customerProfile, patientId, data) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: { id: patientId, agencyId: customerProfile.id },
    });

    if (!patient) {
        throw new NotFoundError("Patient not found");
    }

    const updated = await prisma.patient.update({
        where: { id: patientId },
        data: {
            ...(data.fullName && { fullName: data.fullName }),
            ...(data.email !== undefined && { email: data.email || null }),
            ...(data.phone !== undefined && { phone: data.phone || null }),
            ...(data.addressLine1 !== undefined && { addressLine1: data.addressLine1 || null }),
            ...(data.addressLine2 !== undefined && { addressLine2: data.addressLine2 || null }),
            ...(data.city !== undefined && { city: data.city || null }),
            ...(data.state !== undefined && { state: data.state || null }),
            ...(data.zipCode !== undefined && { zipCode: data.zipCode || null }),
            ...(data.latitude !== undefined && { latitude: data.latitude ?? null }),
            ...(data.longitude !== undefined && { longitude: data.longitude ?? null }),
        }
    });

    return updated;
}

/**
 * Soft-delete a patient (set isActive = false)
 */
export const softDeletePatient = async (customerProfile, patientId) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: { id: patientId, agencyId: customerProfile.id },
    });

    if (!patient) {
        throw new NotFoundError("Patient not found");
    }

    // Block deletion if patient has a linked user account
    if (patient.userId) {
        const err = new Error("Cannot deactivate a patient who has registered account. Contact admin.");
        err.statusCode = 400;
        throw err;
    }

    const updated = await prisma.patient.update({
        where: { id: patientId },
        data: { isActive: false },
    });

    return updated;
}