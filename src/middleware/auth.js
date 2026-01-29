import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";

/**
 * Authenticate JWT token
 */
export const authenticate = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            include: {
                customerProfile: true,
                therapistProfile: true
            },
        });

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: "Invalid or inactive account",
            });
        }

        req.user = user;
        next();
    } catch (error) {
        // Clear invalid cookies
        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
            path: "/",
        });

        return res.status(401).json({
            success: false,
            message: "Invalid token",
        });
    }
};

/**
 * Authorize specific roles
 */
export const authorize = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Insufficient permissions",
            });
        }

        next();
    }
}