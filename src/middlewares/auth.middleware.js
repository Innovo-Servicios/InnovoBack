const Token = require('../controllers/token.controller.js');

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
    const bearerToken = getBearerToken(req.headers.authorization);
    if (bearerToken) {
        return bearerToken;
    }

    if (req.body && typeof req.body.token === 'string' && req.body.token.trim() !== '') {
        return req.body.token.trim();
    }

    if (req.query && typeof req.query.token === 'string' && req.query.token.trim() !== '') {
        return req.query.token.trim();
    }

    if (req.query && typeof req.query.access_token === 'string' && req.query.access_token.trim() !== '') {
        return req.query.access_token.trim();
    }

    return null;
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

        if (req.body && !req.body.token) {
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
        const userRole = String(req.authUser?.cargo || '').trim().toLowerCase();
        if (!userRole || !normalizedRoles.includes(userRole)) {
            return res.status(403).json({ message: 'Permisos insuficientes' });
        }

        return next();
    };
};

module.exports = {
    extractAccessToken,
    requireAuth,
    requireRole,
};
