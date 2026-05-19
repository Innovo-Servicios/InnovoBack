const router = require('express').Router();

const {
    clearRefreshTokenCookie,
    extractRefreshToken,
    refreshSession,
    revokeRefreshToken,
    setRefreshTokenCookie,
    validartoken,
} = require('../controllers/token.controller.js');
const { extractAccessToken, requireAuth } = require('../middlewares/auth.middleware.js');
const { tokenLimiter } = require('../middlewares/rateLimit.middleware.js');


router.get('/',(req, res)=>{
    res.send('Ruta de token');
});

router.post('/creartoken', (_req, res) => {
    res.status(410).json({ message: 'Endpoint deshabilitado' });
});
router.post('/validartoken', tokenLimiter, async (req, res) => {
    try {
        const token = extractAccessToken(req);
        if (!token) {
            return res.status(400).json({ valid: false, message: 'Token no proporcionado' });
        }

        // Llamar a la función de validación de token
        const result = await validartoken(token);

        // Enviar la respuesta según el resultado
        if (result.valid) {
            res.status(200).json({ valid: true});
        } else {
            res.status(result.status).json({ valid: false, message: result.message });
        }
    } catch (error) {
        console.error('Error en el endpoint /validartoken:', error);
        res.status(500).json({ valid: false, message: 'Error interno del servidor' });
    }
});

router.post('/validarToken', tokenLimiter, async (req, res) => {
    try {
        const token = extractAccessToken(req);
        if (!token) {
            return res.status(400).json({ valid: false, message: 'Token no proporcionado' });
        }

        const result = await validartoken(token);
        if (result.valid) {
            return res.status(200).json({ valid: true });
        }

        return res.status(result.status).json({ valid: false, message: result.message });
    } catch (error) {
        return res.status(500).json({ valid: false, message: 'Error interno del servidor' });
    }
});

router.post('/refresh', tokenLimiter, async (req, res) => {
    try {
        const refreshToken = extractRefreshToken(req);
        if (!refreshToken) {
            return res.status(401).json({ message: 'Refresh token no proporcionado' });
        }

        const sessionTokens = await refreshSession(refreshToken);
        setRefreshTokenCookie(res, sessionTokens.refreshToken);

        return res.status(200).json({
            token: sessionTokens.accessToken,
            refreshToken: req.body?.refreshToken ? sessionTokens.refreshToken : undefined,
            deviceId: sessionTokens.deviceId,
        });
    } catch (error) {
        clearRefreshTokenCookie(res);
        return res.status(401).json({ message: 'No se pudo refrescar la sesión' });
    }
});

router.post('/logout', requireAuth, async (req, res) => {
    try {
        const refreshToken = extractRefreshToken(req);
        await revokeRefreshToken(refreshToken);
        clearRefreshTokenCookie(res);
        return res.status(200).json({ message: 'Sesión cerrada' });
    } catch (error) {
        clearRefreshTokenCookie(res);
        return res.status(200).json({ message: 'Sesión cerrada' });
    }
});


module.exports = router;
