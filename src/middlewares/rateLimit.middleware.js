const rateLimit = require('express-rate-limit');

const FIFTEEN_MINUTES_MS = 15 * 60 * 100000;

const authLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiados intentos, intenta nuevamente más tarde' },
});

const tokenLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: 30000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas solicitudes de sesión, intenta nuevamente más tarde' },
});

const uploadLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas cargas de archivos, intenta nuevamente más tarde' },
});

const notificationValidationLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: 30000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiados intentos de validación, intenta nuevamente más tarde' },
});

module.exports = {
    authLimiter,
    tokenLimiter,
    uploadLimiter,
    notificationValidationLimiter,
};
