import { CUSTOMER_TYPES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, AuthorizationError, BadRequestError } from "../utils/errors.js";
import { geocodeAddress, assertCoherenceOrLog } from "./geocoding.service.js";
import { logger } from "../config/logger.js";

/**
 * Throws AuthorizationError if the customer is not an agency account.
 * @param {Object} customerProfile
 */
const requireAgency = (customerProfile) => {
    if (customerProfile.customerType !== CUSTOMER_TYPES.AGENCY) {
        throw new AuthorizationError("Only agency accounts can manage patients");
    }
};

/**
 * Get all active patients for an agency, including their request history.
 * @param {Object} customerProfile
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
 * Create a new patient under the agency.
 * Geocodes the provided address and validates coordinate coherence.
 * @param {Object} customerProfile
 * @param {Object} data - Validated patient data
 */
export const createPatient = async (customerProfile, data) => {
    requireAgency(customerProfile);

    const {
        fullName, dateOfBirth, certificationExpiry,
        email, phone,
        addressLine1, addressLine2, city, state, zipCode,
        latitude, longitude,
    } = data;

    const addressString = [addressLine1, city, state, zipCode].filter(Boolean).join(", ");
    const geocoded = await geocodeAddress(addressString);
    assertCoherenceOrLog("patient.create", latitude, longitude, geocoded.latitude, geocoded.longitude, 5);

    const patient = await prisma.patient.create({
        data: {
            agencyId: customerProfile.id,
            fullName,
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            certificationExpiry: certificationExpiry ? new Date(certificationExpiry) : null,
            email: email || null,
            phone: phone || null,
            addressLine1: addressLine1 || null,
            addressLine2: addressLine2 || null,
            city: geocoded.city || city || null,
            state: geocoded.state || state || null,
            zipCode: geocoded.zipCode || zipCode || null,
            latitude: geocoded.latitude,
            longitude: geocoded.longitude,
            isActive: true,
        },
    });

    logger.info("[Patient] Created", { patientId: patient.id, agencyId: customerProfile.id });
    return patient;
};

/**
 * Get a single patient with their full request and booking history.
 * @param {Object} customerProfile
 * @param {string} patientId
 */
export const getPatientById = async (customerProfile, patientId) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: {
            id: patientId,
            agencyId: customerProfile.id,
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
                        select: { fullName: true, profilePhotoUrl: true },
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
};

/**
 * Update patient contact and address information.
 * Re-geocodes if any address field changes.
 * @param {Object} customerProfile
 * @param {string} patientId
 * @param {Object} data - Validated partial patient data
 */
export const updatePatient = async (customerProfile, patientId, data) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: { id: patientId, agencyId: customerProfile.id },
    });

    if (!patient) {
        throw new NotFoundError("Patient not found");
    }

    const addressChanged =
        data.addressLine1 !== undefined ||
        data.city !== undefined ||
        data.state !== undefined ||
        data.zipCode !== undefined;

    let geocoded = null;
    if (addressChanged) {
        const addressLine1 = data.addressLine1 ?? patient.addressLine1;
        const city = data.city ?? patient.city;
        const state = data.state ?? patient.state;
        const zipCode = data.zipCode ?? patient.zipCode;
        const addressString = [addressLine1, city, state, zipCode].filter(Boolean).join(", ");
        geocoded = await geocodeAddress(addressString);
        assertCoherenceOrLog("patient.update", data.latitude, data.longitude, geocoded.latitude, geocoded.longitude, 5);
    }

    const updated = await prisma.patient.update({
        where: { id: patientId },
        data: {
            ...(data.fullName && { fullName: data.fullName }),
            ...(data.dateOfBirth !== undefined && { dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null }),
            ...(data.certificationExpiry !== undefined && { certificationExpiry: data.certificationExpiry ? new Date(data.certificationExpiry) : null }),
            ...(data.email !== undefined && { email: data.email || null }),
            ...(data.phone !== undefined && { phone: data.phone || null }),
            ...(data.addressLine1 !== undefined && { addressLine1: data.addressLine1 || null }),
            ...(data.addressLine2 !== undefined && { addressLine2: data.addressLine2 || null }),
            ...(geocoded ? {
                city: geocoded.city || data.city || null,
                state: geocoded.state || data.state || null,
                zipCode: geocoded.zipCode || data.zipCode || null,
                latitude: geocoded.latitude,
                longitude: geocoded.longitude,
            } : {}),
        },
    });

    logger.info("[Patient] Updated", { patientId, agencyId: customerProfile.id });
    return updated;
};

/**
 * Soft-delete a patient by setting isActive = false.
 * Blocked if the patient has a linked user account.
 * @param {Object} customerProfile
 * @param {string} patientId
 */
export const softDeletePatient = async (customerProfile, patientId) => {
    requireAgency(customerProfile);

    const patient = await prisma.patient.findFirst({
        where: { id: patientId, agencyId: customerProfile.id },
    });

    if (!patient) {
        throw new NotFoundError("Patient not found");
    }

    if (patient.userId) {
        throw new BadRequestError("Cannot deactivate a patient who has a registered account. Contact admin.");
    }

    const updated = await prisma.patient.update({
        where: { id: patientId },
        data: { isActive: false },
    });

    logger.info("[Patient] Deactivated", { patientId, agencyId: customerProfile.id });
    return updated;
};