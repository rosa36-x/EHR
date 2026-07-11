import { verifyToken } from "../services/authService.js";
import { mspIdForOrg } from "./fabricService.js";
import { OrgActor } from "./db.js";

/**
 * Middleware to verify JWT token on protected routes.
 * Attaches decoded user payload to req.user
 *
 * For org_actor roles, also checks a live ban flag on every request (not
 * just at login) — a JWT stays cryptographically valid until it expires,
 * so a temporary ban imposed mid-session (see anomalyDetectionService.js's
 * escalation logic) has to be enforced here, not just at the login route.
 */
export async function authenticate(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token      = authHeader && authHeader.split(" ")[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ status: "FAILED", message: "Access token required." });
    }

    let decoded;
    try {
        decoded = verifyToken(token);
    } catch (err) {
        return res.status(401).json({ status: "FAILED", message: "Invalid or expired token." });
    }
    req.user = decoded;

    if (decoded.role === "org_actor") {
        try {
            const actor = await OrgActor.findOne({ actorID: decoded.id });
            if (actor?.isBanned) {
                const stillBanned = !actor.bannedUntil || new Date(actor.bannedUntil) > new Date();
                if (stillBanned) {
                    return res.status(403).json({
                        status:  "ACCESS_DENIED",
                        message: actor.bannedUntil
                            ? `Account suspended until ${actor.bannedUntil} pending review.`
                            : "Account suspended pending review.",
                    });
                }
            }
        } catch (err) {
            // Fails OPEN, not closed — a Mongo hiccup here must not lock out
            // every org_actor request. Same philosophy as auditMiddleware.js:
            // this control's own failure shouldn't become a wider outage.
            console.error("[Auth] Ban check failed, allowing request through:", err.message);
        }
    }

    next();
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

/**
 * Middleware to restrict access to org_actor JWTs from a specific org(s),
 * e.g. requireOrgActorOrg("GovernanceMSP") for the anomaly-review routes.
 * Distinct from authorizeRoles(), which only checks req.user.role — every
 * pharmacist/lab-tech/governance-staff JWT shares role "org_actor", so
 * restricting "Governance only" needs the org check too.
 * Use after authenticate().
 */
export function requireOrgActorOrg(...orgs) {
    return (req, res, next) => {
        if (req.user.role !== "org_actor" || !orgs.includes(req.user.org)) {
            return res.status(403).json({
                status:  "FAILED",
                message: `Access denied. Requires an org-actor account in: ${orgs.join(", ")}.`,
            });
        }
        next();
    };
}

/**
 * Middleware to pin the ?org= query param (which selects the Fabric identity
 * used to sign the chaincode call — see fabricService.getContract) to the
 * caller's actual role/org. Without this, org is pure client-supplied trust:
 * a doctor JWT could pass ?org=pharmacy and sign as PharmacyMSP, riding on
 * any consent grant that happens to exist for that patient — even though
 * nothing about the doctor's own identity says "pharmacy".
 *
 * - doctor / patient: only "hospital" is legitimate for them today — they
 *   act through their own Hospital-org identity (treatment relationship /
 *   own-record access), never through a partner org's shared credential.
 * - org_actor: must match the org baked into their own JWT (req.user.org,
 *   e.g. "PharmacyMSP") — an org_actor logged in as PharmacyMSP can never
 *   select ?org=laboratory or ?org=hospital.
 *
 * Use after authenticate(). Reads org from the query param or body,
 * defaulting to "hospital" the same way the route handlers already do.
 */
export function enforceOrgMatchesRole(req, res, next) {
    const org = req.query.org ?? req.body?.org ?? "hospital";

    if (req.user.role === "org_actor") {
        if (mspIdForOrg(org) !== req.user.org) {
            return res.status(403).json({
                status:  "ACCESS_DENIED",
                message: "org param does not match your account's organization.",
            });
        }
        return next();
    }

    if (org !== "hospital") {
        return res.status(403).json({
            status:  "ACCESS_DENIED",
            message: `org param "${org}" is not permitted for role "${req.user.role}".`,
        });
    }

    next();
}