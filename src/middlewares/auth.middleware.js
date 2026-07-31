const Token = require('../controllers/token.controller.js');
const { getUserAccessContext } = require('../services/accessControl.service.js');

const getBearerToken = (authorizationHeader) => {
    if (!authorizationHeader || typeof authorizationHeader !== 'string') {
        return null;
    }

    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return null;
    }

    return token.trim();
};

const extractAccessToken = (req) => {
    return getBearerToken(req.headers.authorization);
};

const requireAuth = async (req, res, next) => {
    try {
        const token = extractAccessToken(req);
        if (!token) {
            return res.status(401).json({ message: 'No autorizado' });
        }

        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res
                .status(tokenValido.status || 401)
                .json({ message: tokenValido.message || 'No autorizado' });
        }

        req.auth = tokenValido.token;
        req.authUser = tokenValido.user;
        req.accessToken = token;
        req.authz = await getUserAccessContext(tokenValido.user);

        if (req.body && typeof req.body === 'object') {
            // Internal compatibility for legacy controllers. Clients must still
            // authenticate with Authorization: Bearer; body/query tokens are ignored.
            req.body.token = token;
        }

        return next();
    } catch (error) {
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const requireRole = (...allowedRoles) => {
    const normalizedRoles = allowedRoles.map((role) => String(role).trim().toLowerCase());

    return (req, res, next) => {
        const userRole = String(req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || '').trim().toLowerCase();
        if (!userRole || !normalizedRoles.includes(userRole)) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }

        return next();
    };
};

const requirePermission = (...requiredPermissions) => {
    const normalized = requiredPermissions.map((permission) => String(permission).trim().toLowerCase());

    return (req, res, next) => {
        const permissions = new Set(req.authz?.permisos || []);
        if (!normalized.every((permission) => permissions.has(permission))) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }
        return next();
    };
};

const requireAnyPermission = (...requiredPermissions) => {
    const normalized = requiredPermissions.map((permission) => String(permission).trim().toLowerCase());

    return (req, res, next) => {
        const permissions = new Set(req.authz?.permisos || []);
        if (!normalized.some((permission) => permissions.has(permission))) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }
        return next();
    };
};

module.exports = {
    extractAccessToken,
    requireAuth,
    requireAnyPermission,
    requirePermission,
    requireRole,
};
