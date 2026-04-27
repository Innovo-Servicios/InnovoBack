const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiados intentos, intenta nuevamente más tarde' },
});

const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas solicitudes de sesión, intenta nuevamente más tarde' },
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas cargas de archivos, intenta nuevamente más tarde' },
});

module.exports = {
    authLimiter,
    tokenLimiter,
    uploadLimiter,
};
