import { GOOGLE_MAPS_API_KEY } from "../config/env.js";
import { logger } from "../config/logger.js";
import { BadRequestError, ServiceUnavailableError } from "../utils/errors.js";
import { ZIP_CACHE_TTL_MS } from "../utils/constants.js";

const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

// ZIP centroid results change rarely — cache for 24h to avoid redundant API calls.
const zipCache = new Map();

// Haversine distance in miles between two lat/lng points.
function distanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function callGeocodingAPI(params) {
    const url = new URL(GEOCODE_BASE);
    url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
        throw new ServiceUnavailableError("Geocoding API request failed");
    }

    const json = await res.json();

    if (json.status === "REQUEST_DENIED" || json.status === "INVALID_REQUEST") {
        logger.error("[GeocodingService] API error", { status: json.status, error_message: json.error_message });
        throw new ServiceUnavailableError("Geocoding service unavailable");
    }

    if (json.status === "ZERO_RESULTS" || !json.results?.length) {
        return null;
    }

    return json.results[0];
}

function parseResult(result) {
    const components = result.address_components || [];

    const find = (...types) =>
        components.find((c) => types.some((t) => c.types.includes(t)));

    const cityComp = find("locality", "sublocality_level_1", "postal_town");
    const stateComp = find("administrative_area_level_1");
    const zipComp = find("postal_code");
    const { lat, lng } = result.geometry.location;

    return {
        latitude: lat,
        longitude: lng,
        city: cityComp?.long_name || "",
        state: stateComp?.short_name || "",
        zipCode: zipComp?.long_name || "",
        formattedAddress: result.formatted_address,
    };
}

export async function geocodeAddress(addressString) {
    const result = await callGeocodingAPI({
        address: addressString,
        components: "country:US",
    });

    if (!result) {
        throw new BadRequestError("Could not resolve the provided address");
    }

    return parseResult(result);
}

export async function geocodeZipCode(zip) {
    const cached = zipCache.get(zip);
    if (cached && Date.now() - cached.ts < ZIP_CACHE_TTL_MS) {
        return cached.data;
    }

    const result = await callGeocodingAPI({
        components: `postal_code:${zip}|country:US`,
    });

    if (!result) {
        throw new BadRequestError(`ZIP code ${zip} could not be resolved`);
    }

    const data = parseResult(result);
    zipCache.set(zip, { data, ts: Date.now() });
    return data;
}

// Validates that client-provided coordinates are within tolerance of the
// server-geocoded result. Logs discrepancies for audit purposes.
export function assertCoherenceOrLog(label, clientLat, clientLng, serverLat, serverLng, toleranceMiles) {
    if (clientLat == null || clientLng == null) return;

    const distance = distanceMiles(clientLat, clientLng, serverLat, serverLng);
    if (distance > toleranceMiles) {
        logger.warn("[GeocodingService] Coordinate mismatch — potential tampering", {
            label,
            clientCoords: { lat: clientLat, lng: clientLng },
            serverCoords: { lat: serverLat, lng: serverLng },
            distanceMiles: distance.toFixed(2),
            toleranceMiles,
        });
    }
}