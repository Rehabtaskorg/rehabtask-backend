import { registerCustomer, registerTherapist, login, getCurrentUser } from "../services/auth.service.js";

/**
 * Cookie options for JWT
 */
const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: 7 * 24 * 60 * 1000, // 7 days in milliseconds
    path: "/",
});


/**
 * Register customer
 */
const registerCustomerController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, location } = req.body;
        const result = await registerCustomer({ email, password, fullName, phone, location })

        // send token as httpOnly cookie
        res.cookie("token", result.token, getCookieOptions());

        // Return user data without token
        res.status(201).json({
            success: true,
            data: { user: result.user }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Register Therapist
 */
const registerTherapistController = async (req, res, next) => {
    try {
        const { email, password, fullName, phone, specialization, licenseNumber } = req.body;
        const result = await registerTherapist({ email, password, fullName, phone, specialization, licenseNumber });

        res.cookie("token", result.token, getCookieOptions());

        res.status(201).json({
            success: true,
            data: { user: result.user }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Login
 */
const loginController = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await login({ email, password });

        res.cookie("token", result.token, getCookieOptions());

        res.status(200).json({
            success: true,
            data: { user: result.user }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Logout
 */
const logoutController = async (req, res, next) => {
    try {
        // Clear the token cookie
        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
            path: "/",
        });

        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get current user
 */
const getCurrentUserController = async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.user.id);

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
}

export {
    registerCustomerController,
    registerTherapistController,
    loginController,
    logoutController,
    getCurrentUserController,
};