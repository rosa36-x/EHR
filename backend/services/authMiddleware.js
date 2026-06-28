import { verifyToken } from "../services/authService.js";

/**
 * Middleware to verify JWT token on protected routes.
 * Attaches decoded user payload to req.user
 */
export function authenticate(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token      = authHeader && authHeader.split(" ")[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ status: "FAILED", message: "Access token required." });
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ status: "FAILED", message: "Invalid or expired token." });
    }
}

/**
 * Middleware to restrict access to specific roles.
 * Use after authenticate().
 *
 * @param {...string} roles - Allowed roles e.g. "doctor", "patient"
 */
export function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                status:  "FAILED",
                message: `Access denied. Required role: ${roles.join(" or ")}.`,
            });
        }
        next();
    };
}