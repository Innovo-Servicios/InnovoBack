const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { trabajador_MongooseModel } = require('../Model/trabajador_Mongoose.js');

const accessSecret = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET}_refresh`;
const accessTtl = process.env.ACCESS_TOKEN_TTL || '15m';
const refreshTtl = process.env.REFRESH_TOKEN_TTL || '30d';
const refreshCookieName = process.env.REFRESH_COOKIE_NAME || 'innovo_rt';
const refreshCookiePath = process.env.REFRESH_COOKIE_PATH || '/token';

const createTokenHash = (token) =>
    crypto.createHash('sha256').update(String(token)).digest('hex');

const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: refreshCookiePath,
    maxAge: 30 * 24 * 60 * 60 * 1000,
});

const normalizeObjectId = (value) => {
    if (!value) {
        return null;
    }

    return String(value).trim();
};

const buildAccessTokenPayload = (user, deviceId) => ({
    sub: normalizeObjectId(user._id),
    rut: user.Rut,
    cargo: user.cargo,
    deviceId,
    sessionVersion: user.sessionVersion || 0,
    type: 'access',
});

const buildRefreshTokenPayload = (user, deviceId) => ({
    sub: normalizeObjectId(user._id),
    rut: user.Rut,
    deviceId,
    sessionVersion: user.sessionVersion || 0,
    type: 'refresh',
});

const signAccessToken = (user, deviceId) =>
    jwt.sign(buildAccessTokenPayload(user, deviceId), accessSecret, { expiresIn: accessTtl });

const signRefreshToken = (user, deviceId) =>
    jwt.sign(buildRefreshTokenPayload(user, deviceId), refreshSecret, { expiresIn: refreshTtl });

const persistRefreshToken = async (user, refreshToken, deviceId) => {
    const decoded = jwt.verify(refreshToken, refreshSecret);
    const tokenHash = createTokenHash(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);
    const safeDeviceId = String(deviceId || 'unknown-device').trim();

    user.refreshTokens = (user.refreshTokens || []).filter(
        (session) =>
            session.deviceId !== safeDeviceId &&
            new Date(session.expiresAt).getTime() > Date.now()
    );

    user.refreshTokens.push({
        tokenHash,
        deviceId: safeDeviceId,
        expiresAt,
        createdAt: new Date(),
        lastUsedAt: new Date(),
    });

    await user.save();
};

const issueSessionTokens = async (user, deviceId) => {
    const safeDeviceId = String(deviceId || `web-${crypto.randomUUID()}`).trim();
    const accessToken = signAccessToken(user, safeDeviceId);
    const refreshToken = signRefreshToken(user, safeDeviceId);

    await persistRefreshToken(user, refreshToken, safeDeviceId);

    return {
        accessToken,
        refreshToken,
        deviceId: safeDeviceId,
    };
};

async function crearToken(datosTrabajador) {
    const { rut, ID } = datosTrabajador;
    const usuarioExistente = await trabajador_MongooseModel.findOne({
        Rut: { $eq: String(rut) },
    });

    if (!usuarioExistente) {
        throw new Error('Trabajador no encontrado');
    }

    return signAccessToken(usuarioExistente, ID || `web-${crypto.randomUUID()}`);
}

async function validartoken(token) {
    try {
        const tokenValido = jwt.verify(token, accessSecret);
        if (tokenValido.type !== 'access') {
            return { valid: false, status: 401, message: 'Token inválido' };
        }

        const user = await trabajador_MongooseModel.findOne({
            _id: { $eq: String(tokenValido.sub) },
        });

        if (!user) {
            return { valid: false, status: 401, message: 'Usuario no encontrado' };
        }

        if ((user.sessionVersion || 0) !== (tokenValido.sessionVersion || 0)) {
            return { valid: false, status: 401, message: 'Sesión inválida' };
        }

        if (tokenValido.rut !== user.Rut) {
            return { valid: false, status: 401, message: 'Token inválido' };
        }

        return { valid: true, token: tokenValido, user };
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, status: 401, message: 'Token expirado' };
        }

        return {
            valid: false,
            status: 401,
            message: 'Token inválido',
        };
    }
}

const extractRefreshToken = (req) => {
    if (req.cookies && req.cookies[refreshCookieName]) {
        return req.cookies[refreshCookieName];
    }

    if (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken.trim() !== '') {
        return req.body.refreshToken.trim();
    }

    const headerToken = req.headers['x-refresh-token'];
    if (typeof headerToken === 'string' && headerToken.trim() !== '') {
        return headerToken.trim();
    }

    return null;
};

const refreshSession = async (refreshToken) => {
    const decoded = jwt.verify(refreshToken, refreshSecret);
    if (decoded.type !== 'refresh') {
        throw new Error('Tipo de token inválido');
    }

    const user = await trabajador_MongooseModel.findOne({
        _id: { $eq: String(decoded.sub) },
    });

    if (!user) {
        throw new Error('Usuario no encontrado');
    }

    if ((user.sessionVersion || 0) !== (decoded.sessionVersion || 0)) {
        throw new Error('Sesión inválida');
    }

    const tokenHash = createTokenHash(refreshToken);
    const existingSession = (user.refreshTokens || []).find(
        (session) =>
            session.tokenHash === tokenHash &&
            new Date(session.expiresAt).getTime() > Date.now()
    );

    if (!existingSession) {
        throw new Error('Sesión inválida');
    }

    user.refreshTokens = (user.refreshTokens || []).filter(
        (session) => session.tokenHash !== tokenHash
    );
    await user.save();

    return issueSessionTokens(user, decoded.deviceId || existingSession.deviceId);
};

const revokeRefreshToken = async (refreshToken) => {
    if (!refreshToken) {
        return;
    }

    try {
        const decoded = jwt.verify(refreshToken, refreshSecret);
        const user = await trabajador_MongooseModel.findOne({
            _id: { $eq: String(decoded.sub) },
        });

        if (!user) {
            return;
        }

        const tokenHash = createTokenHash(refreshToken);
        user.refreshTokens = (user.refreshTokens || []).filter(
            (session) => session.tokenHash !== tokenHash
        );
        await user.save();
    } catch (error) {
        return;
    }
};

const setRefreshTokenCookie = (res, refreshToken) => {
    res.cookie(refreshCookieName, refreshToken, getCookieOptions());
};

const clearRefreshTokenCookie = (res) => {
    res.clearCookie(refreshCookieName, getCookieOptions());
};

module.exports = {
    clearRefreshTokenCookie,
    crearToken,
    extractRefreshToken,
    issueSessionTokens,
    refreshCookieName,
    refreshSession,
    revokeRefreshToken,
    setRefreshTokenCookie,
    validartoken,
};
