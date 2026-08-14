//borrar, listar, filtrar -tipo-fecha
const mongoose = require('mongoose');
const Token = require('../controllers/token.controller.js');
const {
    notificaciones_MongooseModel,
} = require('../models/notificacion.model.js');
const { trabajador_MongooseModel } = require('../models/trabajador.model.js');
const { TipoNotificacion } = require('../models/tipoNotificacion.model.js');
const {
    notificacion_vista_MongooseModel,
} = require('../models/notificacion_vista.model.js');
const {
    tipoDocumento_MongooseModel,
} = require('../models/tipoDocumento.model.js');
const { documentos_MongooseModel } = require('../models/documentos.model.js');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { resolveCompanyDocumentPath } = require('../services/companyDocuments.service.js');
const { ensureCompanyDocumentSignedPdf } = require('../services/companyDocumentSignedPdf.service.js');
const {
    notificacion_validacion_MongooseModel,
} = require('../models/notificacion_validacion.model.js');
const moment = require('moment-timezone');
const Dayjs = require('dayjs');
const fetch = require('node-fetch');
const path = require('node:path');
const sharp = require('sharp');
const fs = require('node:fs');
const crypto = require('node:crypto');

const NOTIFICATION_ALLOWED_FORMATS = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
]);
const NOTIFICATION_IMAGE_FORMATS = new Set([
    'image/jpeg',
    'image/png',
    'image/jpg',
]);
const NOTIFICATION_IMAGE_OUTPUT_MIME_TYPE = 'image/jpeg';
const NOTIFICATION_DEFAULT_PAGE_LIMIT = 20;
const NOTIFICATION_MAX_PAGE_LIMIT = 50;
const NOTIFICATION_TIMEZONE = 'America/Santiago';
const NOTIFICATION_CHANNEL_ID = 'default';
const NOTIFICATION_STATE = Object.freeze({
    SCHEDULED: 'programada',
    SENDING: 'enviando',
    SENT: 'enviado',
    FAILED: 'fallida',
});
const NOTIFICATION_SCHEDULE_MIN_OFFSET_MINUTES = Number.parseInt(
    process.env.NOTIFICATION_SCHEDULE_MIN_OFFSET_MINUTES || '10',
    10
);
const NOTIFICATION_SCHEDULE_MAX_DAYS = Number.parseInt(
    process.env.NOTIFICATION_SCHEDULE_MAX_DAYS || '90',
    10
);
const SCHEDULED_NOTIFICATION_BATCH_SIZE = Number.parseInt(
    process.env.SCHEDULED_NOTIFICATION_BATCH_SIZE || '25',
    10
);
const SCHEDULED_NOTIFICATION_MAX_ATTEMPTS = Number.parseInt(
    process.env.SCHEDULED_NOTIFICATION_MAX_ATTEMPTS || '3',
    10
);
const NOTIFICATION_CODE_TTL_HOURS = Number.parseInt(
    process.env.NOTIFICATION_CODE_TTL_HOURS || '12',
    10
);
const NOTIFICATION_CODE_MAX_ATTEMPTS = Number.parseInt(
    process.env.NOTIFICATION_CODE_MAX_ATTEMPTS || '5',
    10
);
const NOTIFICATION_CODE_SECRET_SELECT = '+codeHash +codeEncrypted +codeIv +codeTag';
const NOTIFICATION_CODE_DISPLAY_SELECT = '+codeEncrypted +codeIv +codeTag';
const EXPO_PUSH_RECEIPT_DELAY_MS = Number.parseInt(
    process.env.EXPO_PUSH_RECEIPT_DELAY_MS || '30000',
    10
);
const NOTIFICATION_UPLOAD_DIRS = [
    path.join(__dirname, '../../storage/uploads'),
    path.join(__dirname, '../../uploads'),
    '/home/backend/Innovo-app/Backend/uploads',
    ...(process.env.NOTIFICATION_UPLOAD_DIRS || '')
        .split(',')
        .map((uploadDir) => uploadDir.trim())
        .filter(Boolean),
].map((uploadDir) => path.resolve(uploadDir));

const logHandledError = (context, error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${context}: ${errorMessage}`);
};

const parseBoolean = (value) =>
    value === true ||
    value === 'true' ||
    value === '1' ||
    value === 1 ||
    value === 'on';

const getAdministrativeSignatureMetadata = (notification) => {
    const metadata = notification?.metadata && typeof notification.metadata === 'object'
        ? notification.metadata
        : {};

    return {
        modoRegistro: typeof metadata.modoRegistro === 'string' ? metadata.modoRegistro : null,
        tipoFirmaAdministrativa: typeof metadata.tipoFirmaAdministrativa === 'string'
            ? metadata.tipoFirmaAdministrativa
            : null,
    };
};

const getNotificationCodeSecret = () => {
    const secret = process.env.NOTIFICATION_CODE_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('Falta configurar NOTIFICATION_CODE_SECRET');
    }

    return secret;
};

const buildCodeExpiresAt = (baseDate = new Date()) => {
    const ttlHours = Number.isFinite(NOTIFICATION_CODE_TTL_HOURS)
        ? NOTIFICATION_CODE_TTL_HOURS
        : 12;
    const baseTime = new Date(baseDate).getTime();
    const safeBaseTime = Number.isNaN(baseTime) ? Date.now() : baseTime;
    return new Date(safeBaseTime + ttlHours * 60 * 60 * 1000);
};

const generateSixDigitCode = (usedCodes = new Set()) => {
    let code;
    do {
        code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    } while (usedCodes.has(code));

    usedCodes.add(code);
    return code;
};

const hashNotificationCode = ({ notificationId, trabajadorId, code }) =>
    crypto
        .createHmac('sha256', getNotificationCodeSecret())
        .update(`${notificationId}:${trabajadorId}:${code}`)
        .digest('hex');

const getNotificationCodeEncryptionKey = () =>
    crypto.createHash('sha256').update(getNotificationCodeSecret()).digest();

const encryptNotificationCode = (code) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        getNotificationCodeEncryptionKey(),
        iv
    );
    const encrypted = Buffer.concat([
        cipher.update(String(code), 'utf8'),
        cipher.final(),
    ]);

    return {
        codeEncrypted: encrypted.toString('base64'),
        codeIv: iv.toString('base64'),
        codeTag: cipher.getAuthTag().toString('base64'),
    };
};

const decryptNotificationCode = (validation) => {
    if (!validation?.codeEncrypted || !validation?.codeIv || !validation?.codeTag) {
        return null;
    }

    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            getNotificationCodeEncryptionKey(),
            Buffer.from(validation.codeIv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(validation.codeTag, 'base64'));

        return Buffer.concat([
            decipher.update(Buffer.from(validation.codeEncrypted, 'base64')),
            decipher.final(),
        ]).toString('utf8');
    } catch (error) {
        logHandledError('No se pudo descifrar el código de notificación', error);
        return null;
    }
};

const clearValidationCode = (validation) => {
    if (!validation) {
        return;
    }

    validation.set('codeHash', undefined);
    validation.set('codeEncrypted', undefined);
    validation.set('codeIv', undefined);
    validation.set('codeTag', undefined);
};

const hashesMatch = (left, right) => {
    if (!left || !right || left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const normalizeValidationCode = (code) =>
    String(code || '').replace(/\D/g, '').slice(0, 6);

const getEffectiveValidationState = (validation) => {
    if (!validation) {
        return null;
    }

    if (
        ['pendiente', 'firmado'].includes(validation.estado) &&
        validation.expiresAt &&
        new Date(validation.expiresAt).getTime() < Date.now()
    ) {
        return 'vencido';
    }

    return validation.estado;
};

const expireStaleValidations = async (filter = {}) =>
    notificacion_validacion_MongooseModel.updateMany(
        {
            ...filter,
            estado: { $in: ['pendiente', 'firmado'] },
            expiresAt: { $lt: new Date() },
        },
        {
            $set: { estado: 'vencido' },
            $unset: {
                codeHash: '',
                codeEncrypted: '',
                codeIv: '',
                codeTag: '',
            },
        }
    );

const formatValidationForClient = (validation, required = false, options = {}) => {
    if (!validation) {
        return required
            ? {
                required: true,
                estado: 'pendiente',
                expiresAt: null,
                firmadoAt: null,
                aceptadoAt: null,
                intentos: 0,
                attemptsRemaining: NOTIFICATION_CODE_MAX_ATTEMPTS,
            }
            : { required: false };
    }

    const maxIntentos = validation.maxIntentos || NOTIFICATION_CODE_MAX_ATTEMPTS;
    const intentos = validation.intentos || 0;
    const estado = getEffectiveValidationState(validation);
    const shouldIncludeCode = options.includeCode && estado === 'pendiente';
    const codigo = shouldIncludeCode ? decryptNotificationCode(validation) : null;

    const formattedValidation = {
        required: true,
        estado,
        expiresAt: validation.expiresAt || null,
        firmadoAt: validation.firmadoAt || null,
        aceptadoAt: validation.aceptadoAt || null,
        intentos,
        attemptsRemaining: Math.max(maxIntentos - intentos, 0),
    };

    if (validation.codigoValidacion) {
        formattedValidation.codigoValidacion = validation.codigoValidacion;
    }

    if (validation.documentoFirmado?.rutaRelativa) {
        formattedValidation.documentoFirmadoUrl = `/documentoEmpresa/firmas/${validation._id}/documento-firmado`;
        formattedValidation.documentoFirmadoNombre = validation.documentoFirmado.nombreOriginal || 'documento-firmado.pdf';
        formattedValidation.verificacionUrl = validation.documentoFirmado.verificationUrl || null;
    }

    if (options.includeCode) {
        formattedValidation.codigo = codigo;
    }

    return formattedValidation;
};

const getValidationMapForWorker = async (notificaciones, trabajador) => {
    const notificationIds = notificaciones
        .filter((notificacion) => notificacion?._id)
        .map((notificacion) => notificacion._id);

    if (!trabajador?._id || notificationIds.length === 0) {
        return new Map();
    }

    await expireStaleValidations({
        trabajador: trabajador._id,
        notificacion: { $in: notificationIds },
    });

    const validations = await notificacion_validacion_MongooseModel.find({
        trabajador: trabajador._id,
        notificacion: { $in: notificationIds },
    }).select(NOTIFICATION_CODE_DISPLAY_SELECT);

    return new Map(
        validations.map((validation) => [
            validation.notificacion.toString(),
            validation,
        ])
    );
};

const getValidationForWorkerAndNotification = async (notificacion, trabajador) => {
    if (!notificacion?.requiereFirma || !trabajador?._id) {
        return null;
    }

    return notificacion_validacion_MongooseModel.findOne({
        notificacion: notificacion._id,
        trabajador: trabajador._id,
    }).select(NOTIFICATION_CODE_DISPLAY_SELECT);
};

const buildValidationResponse = (validation) => ({
    validacion: formatValidationForClient(validation, Boolean(validation)),
});

const buildNotificationDownloadUrl = (notificationId, notificationPath) => {
    const safeFileName = path.basename(String(notificationPath || 'adjunto'));
    return `/notificaciones/archivo/${notificationId}/${encodeURIComponent(safeFileName)}`;
};

const resolveNotificationAttachmentPath = (notificationPath) => {
    const safeFileName = path.basename(String(notificationPath || ''));
    if (!safeFileName) {
        return null;
    }

    return NOTIFICATION_UPLOAD_DIRS
        .map((uploadDir) => path.join(uploadDir, safeFileName))
        .find((candidatePath) => {
            const resolvedPath = path.resolve(candidatePath);
            const allowedBasePath = NOTIFICATION_UPLOAD_DIRS.find((uploadDir) =>
                resolvedPath.startsWith(`${uploadDir}${path.sep}`)
            );

            return Boolean(allowedBasePath) && fs.existsSync(resolvedPath);
        }) || null;
};

const formatNotificationUrlForClient = (notificationId, notificationUrl) => {
    if (!notificationUrl) {
        return null;
    }

    const stringUrl = String(notificationUrl);
    if (/^https?:\/\//i.test(stringUrl)) {
        return stringUrl;
    }

    return buildNotificationDownloadUrl(notificationId, stringUrl);
};

const formatNotificationDateForClient = (fecha) => {
    const parsedDate = new Date(fecha);
    if (Number.isNaN(parsedDate.getTime())) {
        return fecha;
    }

    return parsedDate.toISOString();
};

const parseScheduledNotificationDate = (value) => {
    if (!value) {
        return null;
    }

    const rawValue = String(value).trim();
    const valueWithoutZoneName = rawValue.replace(/\[[^\]]+\]$/, '');
    const hasExplicitOffset = /(?:z|[+-]\d{2}:?\d{2})$/i.test(valueWithoutZoneName);
    const parsedDate = hasExplicitOffset
        ? moment(valueWithoutZoneName)
        : moment.tz(valueWithoutZoneName, NOTIFICATION_TIMEZONE);

    if (!parsedDate.isValid()) {
        return null;
    }

    return parsedDate.toDate();
};

const buildNotificationSchedule = ({ programada, fechaProgramacion }) => {
    if (!parseBoolean(programada)) {
        return {
            isScheduled: false,
            scheduledDate: null,
        };
    }

    const scheduledDate = parseScheduledNotificationDate(fechaProgramacion);
    if (!scheduledDate) {
        const error = new Error('La fecha de programación no es válida');
        error.statusCode = 400;
        throw error;
    }

    const minOffsetMinutes = Number.isFinite(NOTIFICATION_SCHEDULE_MIN_OFFSET_MINUTES)
        ? NOTIFICATION_SCHEDULE_MIN_OFFSET_MINUTES
        : 10;
    const maxScheduleDays = Number.isFinite(NOTIFICATION_SCHEDULE_MAX_DAYS)
        ? NOTIFICATION_SCHEDULE_MAX_DAYS
        : 90;
    const minDate = moment().tz(NOTIFICATION_TIMEZONE).add(minOffsetMinutes, 'minutes').toDate();
    const maxDate = moment().tz(NOTIFICATION_TIMEZONE).add(maxScheduleDays, 'days').endOf('day').toDate();

    if (scheduledDate.getTime() < minDate.getTime()) {
        const error = new Error(
            `La notificación debe programarse al menos ${minOffsetMinutes} minutos hacia adelante`
        );
        error.statusCode = 400;
        throw error;
    }

    if (scheduledDate.getTime() > maxDate.getTime()) {
        const error = new Error(
            `La notificación solo puede programarse hasta ${maxScheduleDays} días hacia adelante`
        );
        error.statusCode = 400;
        throw error;
    }

    return {
        isScheduled: true,
        scheduledDate,
    };
};

const getCreatedNotificationMessage = (notificacion) =>
    notificacion?.estado === NOTIFICATION_STATE.SCHEDULED
        ? 'Notificación programada correctamente'
        : 'Notificación creada correctamente';

const sanitizeNotificationForClient = (notificacion) => {
    if (!notificacion) {
        return notificacion;
    }

    const plainNotification = typeof notificacion.toObject === 'function'
        ? notificacion.toObject()
        : { ...notificacion };

    plainNotification.url = formatNotificationUrlForClient(
        plainNotification._id || plainNotification.id,
        plainNotification.url
    );

    return plainNotification;
};

const normalizeNotificationPageLimit = (limit) => {
    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return NOTIFICATION_DEFAULT_PAGE_LIMIT;
    }

    return Math.min(parsedLimit, NOTIFICATION_MAX_PAGE_LIMIT);
};

const encodeNotificationCursor = (notificacion) => {
    if (!notificacion?.fecha || !notificacion?._id) {
        return null;
    }

    return Buffer.from(JSON.stringify({
        fecha: new Date(notificacion.fecha).toISOString(),
        id: notificacion._id.toString(),
    })).toString('base64url');
};

const decodeNotificationCursor = (cursor) => {
    if (!cursor || typeof cursor !== 'string') {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!decoded.fecha || !decoded.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
            return null;
        }

        const fecha = new Date(decoded.fecha);
        if (Number.isNaN(fecha.getTime())) {
            return null;
        }

        return {
            fecha,
            id: new mongoose.Types.ObjectId(decoded.id),
        };
    } catch (error) {
        logHandledError('Cursor de notificaciones inválido', error);
        return null;
    }
};

const buildNotificationCursorQuery = (cursor) => {
    const decodedCursor = decodeNotificationCursor(cursor);
    if (!decodedCursor) {
        return {};
    }

    return {
        $or: [
            { fecha: { $lt: decodedCursor.fecha } },
            {
                fecha: decodedCursor.fecha,
                _id: { $lt: decodedCursor.id },
            },
        ],
    };
};

const toObjectIdStrings = (ids = []) => ids.map((id) => id.toString());

const hasObjectId = (ids = [], targetId) =>
    toObjectIdStrings(ids).includes(String(targetId));

const getHiddenNotificationIds = (trabajador) =>
    new Set(toObjectIdStrings(trabajador.notificacionesEliminadas || []));

const getWorkerNotificationIds = (trabajador) => {
    const hiddenIds = getHiddenNotificationIds(trabajador);

    return [
        ...new Set([
            ...toObjectIdStrings(trabajador.notificaciones || []),
            ...toObjectIdStrings(trabajador.vistas || []),
        ]),
    ].filter((id) => !hiddenIds.has(id));
};

const getNotificationTypeMap = async (notificaciones) => {
    const tipoIds = [
        ...new Set(
            notificaciones
                .filter((notificacion) => notificacion.tipo)
                .map((notificacion) => notificacion.tipo.toString())
        ),
    ];

    if (tipoIds.length === 0) {
        return {};
    }

    const tipos = await TipoNotificacion.find({
        _id: { $in: tipoIds },
    });

    return tipos.reduce((acc, tipo) => {
        acc[tipo._id.toString()] = tipo.value;
        return acc;
    }, {});
};

const isNotificationImageMimeType = (mimeType) =>
    String(mimeType || '').toLowerCase().startsWith('image/');

const getNotificationAttachmentMimeType = (mimeType, filePath) => {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    if (extension === '.jpg' || extension === '.jpeg') {
        return 'image/jpeg';
    }
    if (extension === '.png') {
        return 'image/png';
    }

    return mimeType || null;
};

const getNotificationDocumentId = (notificacion) =>
    notificacion?.documento?._id || notificacion?.documento || null;

const getNotificationDocumentMap = async (notificaciones) => {
    const documentIds = [
        ...new Set(
            notificaciones
                .map(getNotificationDocumentId)
                .filter(Boolean)
                .map((id) => id.toString())
        ),
    ];

    if (documentIds.length === 0) {
        return new Map();
    }

    const documentos = await documentos_MongooseModel
        .find({ _id: { $in: documentIds } })
        .select('formato');

    return new Map(
        documentos.map((documento) => [documento._id.toString(), documento])
    );
};

const getNotificationAttachmentMeta = (notificacion, documentMap = new Map()) => {
    const documentId = getNotificationDocumentId(notificacion);
    const documento = documentId ? documentMap.get(documentId.toString()) : null;
    const archivoMimeType = getNotificationAttachmentMimeType(
        documento?.formato,
        notificacion?.url
    );

    return {
        archivoMimeType,
        archivoEsImagen: isNotificationImageMimeType(archivoMimeType),
    };
};

const formatNotificationsForApp = async (notificaciones, trabajador) => {
    const vistasSet = new Set((trabajador.vistas || []).map((id) => id.toString()));
    const tiposMap = await getNotificationTypeMap(notificaciones);
    const validationMap = await getValidationMapForWorker(notificaciones, trabajador);
    const documentMap = await getNotificationDocumentMap(notificaciones);

    return notificaciones.map((notificacion) => ({
        id: notificacion._id.toString(),
        tipo: tiposMap[notificacion.tipo.toString()] || 'Desconocido',
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        contenido: notificacion.contenido,
        fecha: formatNotificationDateForClient(notificacion.fecha),
        url: formatNotificationUrlForClient(notificacion._id, notificacion.url),
        estado: vistasSet.has(notificacion._id.toString()),
        metadata: notificacion.metadata || undefined,
        ...getNotificationAttachmentMeta(notificacion, documentMap),
        validacion: formatValidationForClient(
            validationMap.get(notificacion._id.toString()),
            Boolean(notificacion.requiereFirma),
            { includeCode: true }
        ),
    }));
};

const formatLiveNotificationForApp = async (notificacion, trabajador) => {
    const tiposMap = await getNotificationTypeMap([notificacion]);
    const validation = await getValidationForWorkerAndNotification(notificacion, trabajador);
    const documentMap = await getNotificationDocumentMap([notificacion]);

    return {
        id: notificacion._id.toString(),
        tipo: tiposMap[notificacion.tipo.toString()] || 'Desconocido',
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        contenido: notificacion.contenido,
        fecha: formatNotificationDateForClient(notificacion.fecha),
        url: formatNotificationUrlForClient(notificacion._id, notificacion.url),
        estado: false,
        metadata: notificacion.metadata || undefined,
        ...getNotificationAttachmentMeta(notificacion, documentMap),
        validacion: formatValidationForClient(
            validation,
            Boolean(notificacion.requiereFirma),
            { includeCode: true }
        ),
    };
};

const normalizeNotificationTargets = (objetivo) => {
    if (Array.isArray(objetivo)) {
        return objetivo;
    }

    if (typeof objetivo !== 'string') {
        return [];
    }

    try {
        const parsedTargets = JSON.parse(objetivo);
        return Array.isArray(parsedTargets) ? parsedTargets : [];
    } catch (error) {
        logHandledError('No se pudo interpretar el objetivo de la notificación', error);
        return [];
    }
};

const getTargetWorkers = async (objetivoArray, cargoArray = [], roleIds = []) => {
    if (objetivoArray[0] === 'all') {
        return trabajador_MongooseModel.find();
    }

    if (objetivoArray.length > 0) {
        return trabajador_MongooseModel.find({
            Rut: { $in: objetivoArray },
        });
    }

    if (roleIds.length > 0) {
        const validRoleIds = roleIds.filter((id) => mongoose.isValidObjectId(id));
        return trabajador_MongooseModel.find({ rol: { $in: validRoleIds } });
    }

    if (cargoArray.length > 0) {
        return trabajador_MongooseModel.find({
            $or: [
                { arquetipo: { $in: cargoArray } },
                { arquetipo: { $exists: false }, cargo: { $in: cargoArray } },
            ],
        });
    }

    return [];
};

const createSignatureValidations = async ({
    nuevaNotificacion,
    trabajadores,
    expiresAtBase,
    documentoEmpresa,
    firmanteIds = new Map(),
}) => {
    if (!nuevaNotificacion.requiereFirma) {
        return null;
    }

    const expiresAt = buildCodeExpiresAt(expiresAtBase);

    if (nuevaNotificacion.firmaAutomatica) {
        const signedAt = new Date();
        const validations = await notificacion_validacion_MongooseModel.insertMany(
            trabajadores.map((trabajador) => ({
                notificacion: nuevaNotificacion._id,
                trabajador: trabajador._id,
                documentoEmpresa: documentoEmpresa?._id || documentoEmpresa,
                firmanteDocumento: firmanteIds.get(String(trabajador._id)),
                expiresAt,
                estado: 'aceptado',
                firmaAutomatica: true,
                intentos: 0,
                maxIntentos: Number.isFinite(NOTIFICATION_CODE_MAX_ATTEMPTS)
                    ? NOTIFICATION_CODE_MAX_ATTEMPTS
                    : 5,
                firmadoAt: signedAt,
                aceptadoAt: signedAt,
            }))
        );

        return {
            notificationId: nuevaNotificacion._id.toString(),
            expiresAt: null,
            validations,
            codes: [],
            firmaAutomatica: true,
        };
    }

    const usedCodes = new Set();
    const codes = trabajadores.map((trabajador) => {
        const code = generateSixDigitCode(usedCodes);
        return {
            trabajador,
            code,
            codeHash: hashNotificationCode({
                notificationId: nuevaNotificacion._id,
                trabajadorId: trabajador._id,
                code,
            }),
            encryptedCode: encryptNotificationCode(code),
        };
    });

    const validations = await notificacion_validacion_MongooseModel.insertMany(
        codes.map(({ trabajador, codeHash, encryptedCode }) => ({
            notificacion: nuevaNotificacion._id,
            trabajador: trabajador._id,
            documentoEmpresa: documentoEmpresa?._id || documentoEmpresa,
            firmanteDocumento: firmanteIds.get(String(trabajador._id)),
            codeHash,
            ...encryptedCode,
            expiresAt,
            estado: 'pendiente',
            intentos: 0,
            maxIntentos: Number.isFinite(NOTIFICATION_CODE_MAX_ATTEMPTS)
                ? NOTIFICATION_CODE_MAX_ATTEMPTS
                : 5,
        }))
    );

    return {
        notificationId: nuevaNotificacion._id.toString(),
        expiresAt,
        validations,
        codes: codes.map(({ trabajador, code }) => ({
            trabajadorId: trabajador._id.toString(),
            rut: trabajador.Rut,
            nombre: trabajador.Nombre,
            code,
        })),
    };
};

const buildCreatedNotificationResponse = (nuevaNotificacion, signatureBatch) => {
    if (!signatureBatch) {
        return null;
    }

    if (signatureBatch.firmaAutomatica) {
        return {
            message: `Notificación firmada automáticamente por ${signatureBatch.validations.length} trabajadores sin enviarla a sus dispositivos`,
            notificationId: nuevaNotificacion._id.toString(),
            requiereFirma: true,
            firmaAutomatica: true,
            firmasAutomaticas: signatureBatch.validations.length,
            codigos: [],
        };
    }

    return {
        message: getCreatedNotificationMessage(nuevaNotificacion),
        notificationId: nuevaNotificacion._id.toString(),
        requiereFirma: true,
        firmaAutomatica: false,
        expiresAt: signatureBatch.expiresAt,
        codigos: signatureBatch.codes,
    };
};

const buildPushNotificationData = ({
    contenido,
    notificationId,
    tipo,
    fecha,
    url,
    archivoMimeType = null,
    metadata,
}) => ({
    contenidos: contenido,
    idNotificacion: notificationId?.toString(),
    tipo,
    fecha: formatNotificationDateForClient(fecha),
    url: formatNotificationUrlForClient(notificationId, url),
    archivoMimeType,
    archivoEsImagen: isNotificationImageMimeType(archivoMimeType),
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    ...(metadata ? { metadata } : {}),
});

const createNotificationRecord = ({
    trabajadores,
    tipoId,
    titulo,
    mensaje,
    contenido,
    url,
    fecha,
    requiereFirma,
    firmaAutomatica = false,
    isScheduled,
    scheduledDate,
    documentoId,
    documentoEmpresaId,
    metadata,
}) => new notificaciones_MongooseModel({
    trabajadores: trabajadores.map((trabajador) => trabajador._id),
    tipo: tipoId,
    titulo,
    mensaje,
    contenido,
    url,
    fecha,
    documento: documentoId,
    documentoEmpresa: documentoEmpresaId,
    requiereFirma,
    firmaAutomatica,
    metadata,
    programada: Boolean(isScheduled),
    fechaProgramacion: scheduledDate || undefined,
    fechaEnvio: isScheduled || firmaAutomatica ? undefined : fecha,
    estado: isScheduled ? NOTIFICATION_STATE.SCHEDULED : NOTIFICATION_STATE.SENT,
});

const assignNotificationToWorkers = async ({
    trabajadores,
    nuevaNotificacion,
    titulo,
    mensaje,
    data,
    documentoId,
}) => {
    for (const trabajador of trabajadores) {
        if (!hasObjectId(trabajador.notificaciones, nuevaNotificacion._id)) {
            trabajador.notificaciones.push(nuevaNotificacion._id);
        }
        if (documentoId && !hasObjectId(trabajador.documentos, documentoId)) {
            trabajador.documentos.push(documentoId);
        }

        await pushNotification({
            userId: trabajador._id,
            titulo,
            mensaje,
            data,
        });
        await trabajador.save();
    }
};

const createSystemNotificationForWorkers = async ({
    trabajadores,
    tipo = 'alert',
    titulo,
    mensaje,
    contenido,
    fecha = moment().tz(NOTIFICATION_TIMEZONE).toDate(),
    url = null,
    metadata,
    io,
}) => {
    const targetWorkers = trabajadores.filter(Boolean);
    if (targetWorkers.length === 0) {
        throw new Error('No se encontraron destinatarios para la notificación');
    }

    const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
    if (!restipo) {
        throw new Error(`Tipo de notificación no encontrado: ${tipo}`);
    }

    const nuevaNotificacion = createNotificationRecord({
        trabajadores: targetWorkers,
        tipoId: restipo._id,
        titulo,
        mensaje,
        contenido,
        url,
        fecha,
        requiereFirma: false,
        isScheduled: false,
        metadata,
    });

    await nuevaNotificacion.save();
    const pushData = buildPushNotificationData({
        contenido,
        notificationId: nuevaNotificacion._id,
        tipo: restipo.value,
        fecha,
        url,
        metadata,
    });

    await assignNotificationToWorkers({
        trabajadores: targetWorkers,
        nuevaNotificacion,
        titulo,
        mensaje,
        data: pushData,
    });
    await emitNotificationToWorkers(io, targetWorkers, nuevaNotificacion);

    return nuevaNotificacion;
};

const createCompanyDocumentSignatureNotification = async ({
    documento,
    trabajadores,
    firmanteIds,
    titulo,
    mensaje,
    contenido,
    io,
}) => {
    const notificationType = await TipoNotificacion.findOne({ value: { $eq: 'document' } });
    if (!notificationType) {
        const error = new Error('Tipo de notificación documental no encontrado');
        error.status = 400;
        throw error;
    }
    const fecha = moment().tz(NOTIFICATION_TIMEZONE).toDate();
    const metadata = {
        tipo: 'documento_empresa_firma',
        documentoEmpresaId: String(documento._id),
        serieId: documento.serieId,
        version: documento.version,
        categoria: documento.categoria?.nombre || '',
        documentoTitulo: documento.titulo,
    };
    const notification = createNotificationRecord({
        trabajadores,
        tipoId: notificationType._id,
        titulo,
        mensaje,
        contenido,
        url: documento.archivo.rutaRelativa,
        fecha,
        requiereFirma: true,
        isScheduled: false,
        documentoEmpresaId: documento._id,
        metadata,
    });
    try {
        await notification.save();
        const signatureBatch = await createSignatureValidations({
            nuevaNotificacion: notification,
            trabajadores,
            expiresAtBase: fecha,
            documentoEmpresa: documento,
            firmanteIds,
        });
        const pushData = buildPushNotificationData({
            contenido,
            notificationId: notification._id,
            tipo: notificationType.value,
            fecha,
            url: documento.archivo.rutaRelativa,
            archivoMimeType: documento.archivo.mimeType,
            metadata,
        });
        await assignNotificationToWorkers({
            trabajadores,
            nuevaNotificacion: notification,
            titulo,
            mensaje,
            data: pushData,
        });
        await emitNotificationToWorkers(io, trabajadores, notification);
        return { notification, signatureBatch, validations: signatureBatch.validations };
    } catch (error) {
        if (notification?._id) {
            await Promise.all([
                notificacion_validacion_MongooseModel.deleteMany({ notificacion: notification._id }),
                notificaciones_MongooseModel.deleteOne({ _id: notification._id }),
                ...trabajadores.map(async (trabajador) => {
                    trabajador.notificaciones = (trabajador.notificaciones || []).filter(
                        (id) => String(id) !== String(notification._id)
                    );
                    await trabajador.save().catch(() => undefined);
                }),
            ]);
        }
        throw error;
    }
};

const emitNotificationToWorker = async (io, trabajador, nuevaNotificacion) => {
    if (!io || !trabajador?.Rut || !nuevaNotificacion) {
        return;
    }

    const clientNotification = await formatLiveNotificationForApp(
        nuevaNotificacion,
        trabajador
    );
    io.to(`worker:${trabajador.Rut}`)
        .emit('nuevaNotificacion', clientNotification);
};

const emitNotificationToWorkers = async (io, trabajadores, nuevaNotificacion) => {
    if (!io || !nuevaNotificacion) {
        return;
    }

    for (const trabajador of trabajadores) {
        await emitNotificationToWorker(io, trabajador, nuevaNotificacion);
    }
};

const ensureNotificationUploadPath = () => {
    const uploadPath = path.join(__dirname, '../../storage/uploads');
    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    return uploadPath;
};

const buildNotificationImageName = (fileName) =>
    fileName.replaceAll(/\s/g, '').replace(/\.[^/.]+$/, '.jpeg');

const saveNotificationAttachment = async (archivo) => {
    if (!NOTIFICATION_ALLOWED_FORMATS.has(archivo.mimetype)) {
        return {
            error: `Formato de archivo no permitido: ${archivo.mimetype}`,
        };
    }

    const uploadPath = ensureNotificationUploadPath();
    const fileName = path.basename(`file-${Date.now()}-${archivo.originalname}`);

    if (NOTIFICATION_IMAGE_FORMATS.has(archivo.mimetype)) {
        const finalPath = path.join(
            uploadPath,
            buildNotificationImageName(fileName)
        );

        await sharp(archivo.buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .toFormat('jpeg', { quality: 80 })
            .toFile(finalPath);

        return { finalPath, mimeType: NOTIFICATION_IMAGE_OUTPUT_MIME_TYPE };
    }

    const finalPath = path.join(uploadPath, fileName);
    fs.writeFileSync(finalPath, archivo.buffer);
    return { finalPath, mimeType: archivo.mimetype };
};

const sendExpoPushNotification = async ({ tokenPush, titulo, mensaje, data }) => {
    const mensajeNotificacion = {
        to: tokenPush,
        sound: 'default',
        channelId: NOTIFICATION_CHANNEL_ID,
        priority: 'high',
        tag: data?.idNotificacion ? String(data.idNotificacion) : undefined,
        title: titulo,
        body: mensaje,
        data: data || {},
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(mensajeNotificacion),
    });

    const result = await response.json();
    return {
        ok: response.ok,
        result,
    };
};

const getExpoPushReceiptIds = (result) => {
    const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
    return tickets
        .filter((ticket) => ticket?.status === 'ok' && ticket?.id)
        .map((ticket) => ticket.id);
};

const scheduleExpoPushReceiptCheck = ({ result, userId, rut }) => {
    const receiptIds = getExpoPushReceiptIds(result);
    if (receiptIds.length === 0) {
        return;
    }

    const delay = Number.isFinite(EXPO_PUSH_RECEIPT_DELAY_MS)
        ? EXPO_PUSH_RECEIPT_DELAY_MS
        : 30000;
    const timeout = setTimeout(async () => {
        try {
            const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: receiptIds }),
            });
            const receiptResult = await response.json();
            const failedReceipts = Object.entries(receiptResult?.data || {})
                .filter(([, receipt]) => receipt?.status === 'error');

            if (!response.ok || failedReceipts.length > 0 || receiptResult?.errors) {
                console.warn('Expo Push receipts con error', {
                    userId: String(userId),
                    rut,
                    receiptResult,
                });
            }
        } catch (error) {
            logHandledError(`Error al consultar recibos Expo Push para ${rut || userId}`, error);
        }
    }, delay);

    if (typeof timeout.unref === 'function') {
        timeout.unref();
    }
};

const obtenerNotificaciones = async (req, res) => {
    const { rut, token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajador = await trabajador_MongooseModel.findOne({
                Rut: { $eq: String(rut) },
            });
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }
            const hiddenIds = getHiddenNotificationIds(trabajador);
            const notificaciones = await notificaciones_MongooseModel.find({
                _id: (trabajador.notificaciones || [])
                    .filter((id) => !hiddenIds.has(id.toString())),
            });
            res.send(notificaciones.map((notificacion) => sanitizeNotificationForClient(notificacion)));
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
};
const obtenerNotificacionesDelUser = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    
    // Si el token no es válido, devolvemos un error de autorización
    if (!tokenValido.valid) {
      return res.status(401).send("Token inválido");
    }
  
    try {
      const { rut } = tokenValido.token;
      const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: String(rut) } });
      
      if (!trabajador) {
        return res.status(404).send("Trabajador no encontrado");
      }
  
      const notificacionesIds = getWorkerNotificationIds(trabajador);
  
      const notificaciones = await notificaciones_MongooseModel.find({
        _id: { $in: notificacionesIds }
      });
  
      const notificacionesConTipo = await formatNotificationsForApp(notificaciones, trabajador);
  
      return res.send(notificacionesConTipo);
    } catch (error) {
      return res.status(500).send('Error interno del servidor');
    }
  };

const obtenerNotificacionesDelUserPaginadas = async (req, res) => {
    const { token, cursor } = req.body;
    const tokenValido = await Token.validartoken(token);

    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    try {
        const range = req.body.range === 'older' ? 'older' : 'today';
        const limit = normalizeNotificationPageLimit(req.body.limit);
        const { rut } = tokenValido.token;
        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(rut) },
        });

        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const notificacionesIds = getWorkerNotificationIds(trabajador);
        if (notificacionesIds.length === 0) {
            return res.send({
                items: [],
                nextCursor: null,
                hasMore: false,
                range,
                totalLoaded: 0,
            });
        }

        const startOfToday = moment()
            .tz(NOTIFICATION_TIMEZONE)
            .startOf('day')
            .toDate();
        const startOfTomorrow = moment()
            .tz(NOTIFICATION_TIMEZONE)
            .add(1, 'day')
            .startOf('day')
            .toDate();
        const dateQuery = range === 'today'
            ? { fecha: { $gte: startOfToday, $lt: startOfTomorrow } }
            : { fecha: { $lt: startOfToday } };
        const cursorQuery = buildNotificationCursorQuery(cursor);
        const queryParts = [
            { _id: { $in: notificacionesIds } },
            dateQuery,
        ];

        if (Object.keys(cursorQuery).length > 0) {
            queryParts.push(cursorQuery);
        }

        const notificaciones = await notificaciones_MongooseModel
            .find({ $and: queryParts })
            .sort({ fecha: -1, _id: -1 })
            .limit(limit + 1);
        const hasMore = notificaciones.length > limit;
        const pageItems = hasMore ? notificaciones.slice(0, limit) : notificaciones;
        const items = await formatNotificationsForApp(pageItems, trabajador);

        return res.send({
            items,
            nextCursor: hasMore
                ? encodeNotificationCursor(pageItems[pageItems.length - 1])
                : null,
            hasMore,
            range,
            totalLoaded: items.length,
        });
    } catch (error) {
        return res.status(500).send('Error interno del servidor');
    }
};
  
const crearNotificacion = async (req, res) => {
    const { objetivo, tipo, titulo, mensaje, contenido, url, cargo, roles } = req.body;
    const firmaAutomatica = parseBoolean(req.body.firmaAutomatica);
    const requiereFirma = firmaAutomatica || parseBoolean(req.body.requiereFirma);
    const token = req.accessToken || req.body.token;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (tipo === 'documento' && !url) {
        return res.status(400).send('Falta la URL del documento');
    }

    const objetivoArray = firmaAutomatica
        ? ['all']
        : normalizeNotificationTargets(objetivo);
    const cargoArray = firmaAutomatica ? [] : normalizeNotificationTargets(cargo);
    const roleIds = firmaAutomatica ? [] : normalizeNotificationTargets(roles);
    if (objetivoArray.length === 0 && cargoArray.length === 0 && roleIds.length === 0) {
        return res.status(400).send('Falta el objetivo de la notificación');
    }

    let scheduleConfig;
    try {
        scheduleConfig = buildNotificationSchedule(req.body);
    } catch (error) {
        return res.status(error.statusCode || 400).send(error.message);
    }

    if (firmaAutomatica && scheduleConfig.isScheduled) {
        return res
            .status(400)
            .send('La firma automática se registra al crear la notificación y no puede programarse');
    }

    try {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (!restipo) {
            return res.status(400).send('Tipo de notificación no encontrado');
        }
        const trabajadores = await getTargetWorkers(objetivoArray, cargoArray, roleIds);
        if (trabajadores.length === 0) {
            return res.status(400).send('No se encontraron destinatarios para la notificación');
        }
        const fechaNotificacion = scheduleConfig.isScheduled
            ? scheduleConfig.scheduledDate
            : moment().tz(NOTIFICATION_TIMEZONE).toDate();
        const nuevaNotificacion = createNotificationRecord({
            trabajadores,
            tipoId: restipo._id,
            titulo,
            mensaje,
            contenido,
            url,
            fecha: fechaNotificacion,
            requiereFirma,
            firmaAutomatica,
            isScheduled: scheduleConfig.isScheduled,
            scheduledDate: scheduleConfig.scheduledDate,
        });
        const pushData = buildPushNotificationData({
            contenido,
            notificationId: nuevaNotificacion._id,
            tipo: restipo.value,
            fecha: fechaNotificacion,
            url,
        });

        await nuevaNotificacion.save();
        const signatureBatch = await createSignatureValidations({
            nuevaNotificacion,
            trabajadores,
            expiresAtBase: fechaNotificacion,
        });

        if (!scheduleConfig.isScheduled && !firmaAutomatica) {
            await assignNotificationToWorkers({
                trabajadores,
                nuevaNotificacion,
                titulo,
                mensaje,
                data: pushData,
            });

            await emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);
        }

        const createdResponse = buildCreatedNotificationResponse(
            nuevaNotificacion,
            signatureBatch
        );
        if (createdResponse) {
            return res.status(201).json(createdResponse);
        }

        return res.status(201).send(getCreatedNotificationMessage(nuevaNotificacion));
    } catch (error) {
        return res.status(500).send('Error interno del servidor');
    }
};
const crearNotificacionDocumento = async (req, res) => {
    const { objetivo, tipo, titulo, mensaje, contenido, cargo, roles } = req.body;
    const firmaAutomatica = parseBoolean(req.body.firmaAutomatica);
    const requiereFirma = firmaAutomatica || parseBoolean(req.body.requiereFirma);
    const token = req.accessToken || req.body.token;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (!req.file) {
        return res.status(400).send('Falta el archivo');
    }

    const objetivoArray = firmaAutomatica
        ? ['all']
        : normalizeNotificationTargets(objetivo);
    const cargoArray = firmaAutomatica ? [] : normalizeNotificationTargets(cargo);
    const roleIds = firmaAutomatica ? [] : normalizeNotificationTargets(roles);
    if (objetivoArray.length === 0 && cargoArray.length === 0 && roleIds.length === 0) {
        return res.status(400).send('Falta el objetivo de la notificación');
    }

    let scheduleConfig;
    try {
        scheduleConfig = buildNotificationSchedule(req.body);
    } catch (error) {
        return res.status(error.statusCode || 400).send(error.message);
    }

    if (firmaAutomatica && scheduleConfig.isScheduled) {
        return res
            .status(400)
            .send('La firma automática se registra al crear la notificación y no puede programarse');
    }

    try {
        const restipo = await TipoNotificacion.findOne({ value: { $eq: String(tipo) } });
        if (!restipo) {
            return res.status(400).send('Tipo de notificación no encontrado');
        }
        const trabajadores = await getTargetWorkers(objetivoArray, cargoArray, roleIds);
        if (trabajadores.length === 0) {
            return res.status(400).send('No se encontraron destinatarios para la notificación');
        }
        const archivo = req.file;
        const savedAttachment = await saveNotificationAttachment(archivo);
        if (savedAttachment.error) {
            return res.status(400).send(savedAttachment.error);
        }

        const resTipodocumento = await tipoDocumento_MongooseModel.findOne({
            value: 'Notificacion',
        });
        if (!resTipodocumento) {
            return res.status(400).send('Tipo de documento no encontrado');
        }
        const fechaNotificacion = scheduleConfig.isScheduled
            ? scheduleConfig.scheduledDate
            : moment().tz(NOTIFICATION_TIMEZONE).toDate();
        const nuevoDocumento = new documentos_MongooseModel({
            _id: new mongoose.Types.ObjectId(),
            tipo: resTipodocumento._id,
            nombreOriginal: path.basename(String(archivo.originalname || 'documento')),
            url: savedAttachment.finalPath,
            formato: savedAttachment.mimeType || archivo.mimetype,
            fecha: fechaNotificacion,
        });
        await nuevoDocumento.save();

        const nuevaNotificacion = createNotificationRecord({
            trabajadores,
            tipoId: restipo._id,
            titulo,
            mensaje,
            contenido,
            url: savedAttachment.finalPath,
            fecha: fechaNotificacion,
            requiereFirma,
            firmaAutomatica,
            isScheduled: scheduleConfig.isScheduled,
            scheduledDate: scheduleConfig.scheduledDate,
            documentoId: nuevoDocumento._id,
        });
        const pushData = buildPushNotificationData({
            contenido,
            notificationId: nuevaNotificacion._id,
            tipo: restipo.value,
            fecha: fechaNotificacion,
            url: savedAttachment.finalPath,
            archivoMimeType: savedAttachment.mimeType || archivo.mimetype,
        });

        await nuevaNotificacion.save();
        const signatureBatch = await createSignatureValidations({
            nuevaNotificacion,
            trabajadores,
            expiresAtBase: fechaNotificacion,
        });

        if (!scheduleConfig.isScheduled && !firmaAutomatica) {
            await assignNotificationToWorkers({
                trabajadores,
                nuevaNotificacion,
                titulo,
                mensaje,
                data: pushData,
                documentoId: nuevoDocumento._id,
            });

            await emitNotificationToWorkers(req.io, trabajadores, nuevaNotificacion);
        }

        const createdResponse = buildCreatedNotificationResponse(
            nuevaNotificacion,
            signatureBatch
        );
        if (createdResponse) {
            return res.status(201).json(createdResponse);
        }

        return res.status(201).send(getCreatedNotificationMessage(nuevaNotificacion));
    } catch (error) {
        return res.status(500).send('Error interno del servidor');
    }
};
const eliminarNotificacion = async (req, res) => {
    const { token, id } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (!tokenValido.valid) {
        return res.status(401).send('Token inválido');
    }

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const trabajador = await trabajador_MongooseModel.findOne({
            Rut: { $eq: String(tokenValido.token.rut) },
        });
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const notificacion = await notificaciones_MongooseModel.findById(id);
        if (!notificacion) {
            return res.status(404).send('Notificación no encontrada');
        }

        const assignedWorkerIds = toObjectIdStrings(notificacion.trabajadores || []);
        if (!assignedWorkerIds.includes(trabajador._id.toString())) {
            return res.status(403).send('Notificación no asignada al trabajador');
        }

        let vista = await notificacion_vista_MongooseModel.findOne({
            trabajador: { $eq: trabajador._id },
            notificacion: { $eq: String(id) },
        });
        const hasViewedNotification = Boolean(vista) || hasObjectId(trabajador.vistas, id);
        if (!hasViewedNotification) {
            return res
                .status(409)
                .send('Debes leer la notificación antes de eliminarla');
        }

        if (!vista) {
            vista = new notificacion_vista_MongooseModel({
                trabajador: trabajador._id,
                notificacion: id,
                tiempo: moment().tz('America/Santiago').format('DD-MM-YYYY'),
            });
            await vista.save();
        }

        trabajador.notificaciones = (trabajador.notificaciones || []).filter(
            (notificacionId) => !notificacionId.equals(id)
        );
        if (!hasObjectId(trabajador.vistas, id)) {
            trabajador.vistas.push(id);
        }
        if (!hasObjectId(trabajador.notificacionesEliminadas, id)) {
            trabajador.notificacionesEliminadas.push(id);
        }

        await trabajador.save();
        return res.status(200).send('Notificación eliminada correctamente');
    } catch (error) {
        return res.status(500).send('Error interno del servidor');
    }
};
const infoNotificaciones = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        try {
            const trabajadores = await trabajador_MongooseModel.find(
                {},
                'Rut Nombre'
            );
            const tipoNotificacione = await TipoNotificacion.find({}, 'value');
            res.status(200).send({
                trabajadores: trabajadores,
                tipoNotificacion: tipoNotificacione,
            });
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
};
const buscarNotificacion = async (req, res) => {
    const { token, inicio, fin, todas } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid) {
        const buscarTodas = parseBoolean(todas);
        const fechainicio = Dayjs(inicio).startOf('day').toDate();
        const fechafin = Dayjs(fin).endOf('day').toDate();
        const filtro = buscarTodas
            ? {}
            : {
                fecha: {
                    $gte: fechainicio,
                    $lte: fechafin,
                },
            };

        try {
            const notificaciones = await notificaciones_MongooseModel
                .find(filtro)
                .sort({ fecha: -1 });
            const notificacionesConTipo = await Promise.all(
                notificaciones.map(async (notificacion) => {
                    const tipo = await TipoNotificacion.findById(
                        notificacion.tipo
                    );
                    return {
                        id: notificacion._id,
                        tipo: tipo.value,
                        titulo: notificacion.titulo,
                        mensaje: notificacion.mensaje,
                        contenido: notificacion.contenido,
                        url: notificacion.url,
                        fecha: notificacion.fecha,
                        requiereFirma: Boolean(notificacion.requiereFirma),
                        firmaAutomatica: Boolean(notificacion.firmaAutomatica),
                        ...getAdministrativeSignatureMetadata(notificacion),
                        programada: Boolean(notificacion.programada),
                        fechaProgramacion: notificacion.fechaProgramacion,
                        fechaEnvio: notificacion.fechaEnvio,
                        estado: notificacion.estado || NOTIFICATION_STATE.SENT,
                    };
                })
            );

            notificacionesConTipo.sort((a, b) => b.fecha - a.fecha);
            res.status(200).send(notificacionesConTipo);
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    } else {
        res.status(401).send('Token inválido');
    }
};
const detallesNotificacion = async (req, res) => {
    const { token, idNotificacion } = req.body;
    try {
        const tokenValido = await Token.validartoken(token);
        if (!tokenValido.valid) {
            return res.status(401).send('Token inválido');
        }

        if (!mongoose.Types.ObjectId.isValid(String(idNotificacion))) {
            return res.status(400).send('Notificación inválida');
        }

        const notificacion = await notificaciones_MongooseModel.findById(idNotificacion);
        if (!notificacion) {
            return res.status(404).send('Notificación no encontrada');
        }

        const assignedWorkerIds = notificacion.trabajadores || [];
        const trabajadores = await trabajador_MongooseModel
            .find({ _id: { $in: assignedWorkerIds } })
            .select('Rut Nombre');
        const vistas = await notificacion_vista_MongooseModel.find({
            notificacion: { $eq: String(idNotificacion) },
            trabajador: { $in: assignedWorkerIds },
        });
        const vistasMap = new Map(
            vistas.map((vista) => [vista.trabajador.toString(), vista])
        );
        await expireStaleValidations({
            notificacion: idNotificacion,
            trabajador: { $in: assignedWorkerIds },
        });
        const validaciones = await notificacion_validacion_MongooseModel.find({
            notificacion: { $eq: String(idNotificacion) },
            trabajador: { $in: assignedWorkerIds },
        });
        const validacionesMap = new Map(
            validaciones.map((validacion) => [
                validacion.trabajador.toString(),
                validacion,
            ])
        );
        const trabajadoresVistos = [];
        const trabajadoresNoVistos = [];
        const validacionDetalle = {
            required: Boolean(notificacion.requiereFirma),
            firmaAutomatica: Boolean(notificacion.firmaAutomatica),
            ...getAdministrativeSignatureMetadata(notificacion),
            resumen: {
                pendientes: 0,
                firmados: 0,
                aceptados: 0,
                vencidos: 0,
                bloqueados: 0,
            },
            pendientes: [],
            firmados: [],
            aceptados: [],
            vencidos: [],
            bloqueados: [],
        };

        trabajadores.forEach((trabajador) => {
            const vista = vistasMap.get(trabajador._id.toString());
            const validacion = validacionesMap.get(trabajador._id.toString());
            const item = {
                trabajadorId: trabajador._id.toString(),
                rut: trabajador.Rut,
                nombre: trabajador.Nombre,
            };

            if (notificacion.requiereFirma) {
                const validationItem = {
                    ...item,
                    estado: getEffectiveValidationState(validacion) || 'pendiente',
                    firmaAutomatica: Boolean(validacion?.firmaAutomatica),
                    expiresAt: validacion?.expiresAt || null,
                    firmadoAt: validacion?.firmadoAt || null,
                    aceptadoAt: validacion?.aceptadoAt || null,
                    intentos: validacion?.intentos || 0,
                };

                if (validationItem.estado === 'firmado') {
                    validacionDetalle.resumen.firmados += 1;
                    validacionDetalle.firmados.push(validationItem);
                } else if (validationItem.estado === 'aceptado') {
                    validacionDetalle.resumen.aceptados += 1;
                    validacionDetalle.aceptados.push(validationItem);
                } else if (validationItem.estado === 'vencido') {
                    validacionDetalle.resumen.vencidos += 1;
                    validacionDetalle.vencidos.push(validationItem);
                } else if (validationItem.estado === 'bloqueado') {
                    validacionDetalle.resumen.bloqueados += 1;
                    validacionDetalle.bloqueados.push(validationItem);
                } else {
                    validacionDetalle.resumen.pendientes += 1;
                    validacionDetalle.pendientes.push(validationItem);
                }
            }

            if (vista) {
                trabajadoresVistos.push({
                    ...item,
                    fechaVista: vista.tiempo || null,
                });
                return;
            }

            trabajadoresNoVistos.push(item);
        });

        res.status(200).send({
            no_vista: trabajadoresNoVistos,
            vista: trabajadoresVistos,
            validacion: validacionDetalle,
        });
    } catch (error) {
        res.status(500).send('Error interno del servidor');
    }
};

const getRequestWorker = async (req) => {
    if (req.authUser?._id) {
        return req.authUser;
    }

    const rut = req.auth?.rut || req.body?.rut;
    if (!rut) {
        return null;
    }

    return trabajador_MongooseModel.findOne({ Rut: { $eq: String(rut) } });
};

const expireValidationIfNeeded = async (validation) => {
    if (
        validation &&
        ['pendiente', 'firmado'].includes(validation.estado) &&
        validation.expiresAt &&
        new Date(validation.expiresAt).getTime() < Date.now()
    ) {
        validation.estado = 'vencido';
        clearValidationCode(validation);
        await validation.save();
    }

    return validation;
};

const firmarValidacionNotificacion = async (req, res) => {
    const idNotificacion = String(req.body.idNotificacion || '').trim();
    const codigo = normalizeValidationCode(req.body.codigo);

    if (!mongoose.Types.ObjectId.isValid(idNotificacion)) {
        return res.status(400).send('Notificación inválida');
    }

    if (!/^\d{6}$/.test(codigo)) {
        return res.status(400).send('El código debe tener 6 dígitos');
    }

    try {
        const trabajador = await getRequestWorker(req);
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const validation = await notificacion_validacion_MongooseModel
            .findOne({
                notificacion: { $eq: idNotificacion },
                trabajador: { $eq: trabajador._id },
            })
            .select(NOTIFICATION_CODE_SECRET_SELECT);

        if (!validation) {
            return res.status(404).send('Validación no encontrada');
        }

        await expireValidationIfNeeded(validation);

        if (validation.estado === 'aceptado' || validation.estado === 'firmado') {
            return res.status(200).json(buildValidationResponse(validation));
        }

        if (validation.estado === 'vencido') {
            return res.status(410).send('El código de validación venció');
        }

        if (validation.estado === 'bloqueado') {
            return res.status(423).send('La validación está bloqueada por intentos fallidos');
        }

        const expectedHash = hashNotificationCode({
            notificationId: validation.notificacion,
            trabajadorId: validation.trabajador,
            code: codigo,
        });

        if (!hashesMatch(validation.codeHash, expectedHash)) {
            validation.intentos = (validation.intentos || 0) + 1;
            validation.lastAttemptAt = new Date();

            if (validation.intentos >= (validation.maxIntentos || NOTIFICATION_CODE_MAX_ATTEMPTS)) {
                validation.estado = 'bloqueado';
                clearValidationCode(validation);
            }

            await validation.save();
            return res.status(401).send('Código incorrecto');
        }

        validation.estado = 'firmado';
        validation.firmadoAt = new Date();
        validation.lastAttemptAt = new Date();
        clearValidationCode(validation);
        await validation.save();

        if (validation.documentoEmpresa) {
            req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', {
                id: String(validation.documentoEmpresa),
            });
        }

        return res.status(200).json(buildValidationResponse(validation));
    } catch (error) {
        logHandledError('Error al firmar notificación', error);
        return res.status(500).send('Error interno del servidor');
    }
};

const aceptarValidacionNotificacion = async (req, res) => {
    const idNotificacion = String(req.body.idNotificacion || '').trim();

    if (!mongoose.Types.ObjectId.isValid(idNotificacion)) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const trabajador = await getRequestWorker(req);
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const validation = await notificacion_validacion_MongooseModel
            .findOne({
                notificacion: { $eq: idNotificacion },
                trabajador: { $eq: trabajador._id },
            })
            .select(NOTIFICATION_CODE_SECRET_SELECT);

        if (!validation) {
            return res.status(404).send('Validación no encontrada');
        }

        await expireValidationIfNeeded(validation);

        if (validation.estado === 'aceptado') {
            return res.status(200).json(buildValidationResponse(validation));
        }

        if (validation.estado === 'pendiente') {
            return res.status(409).send('Debes firmar antes de aceptar');
        }

        if (validation.estado === 'vencido') {
            return res.status(410).send('La validación venció');
        }

        if (validation.estado === 'bloqueado') {
            return res.status(423).send('La validación está bloqueada');
        }

        validation.estado = 'aceptado';
        validation.aceptadoAt = new Date();
        clearValidationCode(validation);
        await validation.save();

        if (validation.documentoEmpresa) {
            await ensureCompanyDocumentSignedPdf({ validation, trabajador });
            req.io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', {
                id: String(validation.documentoEmpresa),
            });
        }

        return res.status(200).json(buildValidationResponse(validation));
    } catch (error) {
        logHandledError('Error al aceptar notificación', error);
        return res.status(500).send('Error interno del servidor');
    }
};

const regenerarCodigoValidacion = async (req, res) => {
    const idNotificacion = String(req.body.idNotificacion || '').trim();
    const trabajadorId = String(req.body.trabajadorId || '').trim();
    const rut = String(req.body.rut || '').trim();

    if (!mongoose.Types.ObjectId.isValid(idNotificacion)) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const workerQuery = mongoose.Types.ObjectId.isValid(trabajadorId)
            ? { _id: { $eq: trabajadorId } }
            : { Rut: { $eq: rut } };
        const trabajador = await trabajador_MongooseModel.findOne(workerQuery);
        if (!trabajador) {
            return res.status(404).send('Trabajador no encontrado');
        }

        const validation = await notificacion_validacion_MongooseModel
            .findOne({
                notificacion: { $eq: idNotificacion },
                trabajador: { $eq: trabajador._id },
            })
            .select(NOTIFICATION_CODE_SECRET_SELECT);

        if (!validation) {
            return res.status(404).send('Validación no encontrada');
        }

        await expireValidationIfNeeded(validation);

        if (['firmado', 'aceptado'].includes(validation.estado)) {
            return res.status(409).send('No se puede regenerar una validación ya firmada o aceptada');
        }

        const notificacion = await notificaciones_MongooseModel.findById(idNotificacion);
        const codeExpiresBase =
            notificacion?.estado === NOTIFICATION_STATE.SCHEDULED && notificacion?.fechaProgramacion
                ? notificacion.fechaProgramacion
                : new Date();
        const code = generateSixDigitCode();
        const expiresAt = buildCodeExpiresAt(codeExpiresBase);
        validation.codeHash = hashNotificationCode({
            notificationId: validation.notificacion,
            trabajadorId: validation.trabajador,
            code,
        });
        const encryptedCode = encryptNotificationCode(code);
        validation.codeEncrypted = encryptedCode.codeEncrypted;
        validation.codeIv = encryptedCode.codeIv;
        validation.codeTag = encryptedCode.codeTag;
        validation.expiresAt = expiresAt;
        validation.estado = 'pendiente';
        validation.intentos = 0;
        validation.lastAttemptAt = undefined;
        validation.firmadoAt = undefined;
        validation.aceptadoAt = undefined;
        validation.regeneradoAt = new Date();
        await validation.save();

        await emitNotificationToWorker(req.io, trabajador, notificacion);

        return res.status(200).json({
            message: 'Código regenerado correctamente',
            notificationId: idNotificacion,
            expiresAt,
            codigo: {
                trabajadorId: trabajador._id.toString(),
                rut: trabajador.Rut,
                nombre: trabajador.Nombre,
                code,
            },
        });
    } catch (error) {
        logHandledError('Error al regenerar código de validación', error);
        return res.status(500).send('Error interno del servidor');
    }
};
const pushNotification = async ({ userId, titulo, mensaje, data }) => {
    try {
        const usuario = await trabajador_MongooseModel.findById(userId);
        if (!usuario?.tokenPush) {
            console.warn('Push omitida: trabajador sin tokenPush', {
                userId: String(userId),
                rut: usuario?.Rut,
            });
            return null;
        }
        const tokenPush = usuario.tokenPush;

        if (!tokenPush.startsWith('ExponentPushToken')) {
            console.warn('Push omitida: tokenPush Expo inválido', {
                userId: String(userId),
                rut: usuario.Rut,
            });
            return null;
        }

        const { ok, result } = await sendExpoPushNotification({
            tokenPush,
            titulo,
            mensaje,
            data,
        });
        const pushResult = Array.isArray(result?.data) ? result.data[0] : result?.data;
        if (!ok || pushResult?.status === 'error' || result?.errors) {
            console.warn('Expo Push respondió con error', {
                userId: String(userId),
                rut: usuario.Rut,
                result,
            });
        }
        scheduleExpoPushReceiptCheck({
            result,
            userId,
            rut: usuario.Rut,
        });
        return result;
    } catch (error) {
        logHandledError('Error al enviar notificación push', error);
        return null;
    }
};

const buildPushDataFromNotification = async (notificacion) => {
    const tipo = await TipoNotificacion.findById(notificacion.tipo);
    const documentMap = await getNotificationDocumentMap([notificacion]);
    const attachmentMeta = getNotificationAttachmentMeta(notificacion, documentMap);

    return buildPushNotificationData({
        contenido: notificacion.contenido,
        notificationId: notificacion._id,
        tipo: tipo?.value || 'Desconocido',
        fecha: notificacion.fecha || notificacion.fechaProgramacion || new Date(),
        url: notificacion.url,
        archivoMimeType: attachmentMeta.archivoMimeType,
    });
};

const deliverNotification = async ({ notificacion, io }) => {
    if (notificacion.firmaAutomatica) {
        return;
    }

    const trabajadores = await trabajador_MongooseModel.find({
        _id: { $in: notificacion.trabajadores || [] },
    });

    if (trabajadores.length === 0) {
        throw new Error('No se encontraron destinatarios para la notificación programada');
    }

    const pushData = await buildPushDataFromNotification(notificacion);
    await assignNotificationToWorkers({
        trabajadores,
        nuevaNotificacion: notificacion,
        titulo: notificacion.titulo,
        mensaje: notificacion.mensaje,
        data: pushData,
        documentoId: notificacion.documento,
    });
    await emitNotificationToWorkers(io, trabajadores, notificacion);
};

const claimDueScheduledNotification = () =>
    notificaciones_MongooseModel.findOneAndUpdate(
        {
            programada: true,
            estado: NOTIFICATION_STATE.SCHEDULED,
            fechaProgramacion: { $lte: new Date() },
        },
        {
            $set: {
                estado: NOTIFICATION_STATE.SENDING,
                fechaEnvioIniciado: new Date(),
            },
            $unset: {
                ultimoErrorEnvio: '',
            },
            $inc: {
                intentosEnvio: 1,
            },
        },
        {
            sort: { fechaProgramacion: 1, _id: 1 },
            new: true,
        }
    );

const dispatchDueScheduledNotifications = async (io) => {
    const batchSize = Number.isFinite(SCHEDULED_NOTIFICATION_BATCH_SIZE)
        ? SCHEDULED_NOTIFICATION_BATCH_SIZE
        : 25;
    const maxAttempts = Number.isFinite(SCHEDULED_NOTIFICATION_MAX_ATTEMPTS)
        ? SCHEDULED_NOTIFICATION_MAX_ATTEMPTS
        : 3;
    let processed = 0;

    while (processed < batchSize) {
        const notificacion = await claimDueScheduledNotification();
        if (!notificacion) {
            break;
        }

        try {
            await deliverNotification({ notificacion, io });
            notificacion.estado = NOTIFICATION_STATE.SENT;
            notificacion.fechaEnvio = new Date();
            await notificacion.save();
            processed += 1;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            notificacion.estado = (notificacion.intentosEnvio || 0) >= maxAttempts
                ? NOTIFICATION_STATE.FAILED
                : NOTIFICATION_STATE.SCHEDULED;
            notificacion.ultimoErrorEnvio = errorMessage.slice(0, 500);
            await notificacion.save();
            logHandledError(
                `Error al despachar notificación programada ${notificacion._id}`,
                error
            );
            processed += 1;
        }
    }

    return processed;
};

const pushNotificationOLD = async (req, res) => {
    const { userId, titulo, mensaje, data } = req.body;

    if (!userId || !titulo || !mensaje) {
        return res.status(400).send("Faltan datos obligatorios (userId, titulo, mensaje)");
    }
    try {
        const usuario = await trabajador_MongooseModel.findById(userId, "tokenPush");
        if (!usuario?.tokenPush) {
            return res.status(404).send("Usuario no encontrado o sin tokenPush registrado");
        }

        const tokenPush = usuario.tokenPush;

        if (!tokenPush.startsWith("ExponentPushToken")) {
            return res.status(400).send("El tokenPush no es un token válido de Expo");
        }

        const { ok, result } = await sendExpoPushNotification({
            tokenPush,
            titulo,
            mensaje,
            data,
        });

        if (ok) {
            req.io.to('permission:notificaciones.ver').emit('notificacionPush', {
                title: titulo,
                body: mensaje,
            });
            res.status(200).send("Notificación enviada con éxito");
        } else {
            res.status(500).send("Error al enviar notificación: " + JSON.stringify(result));
        }
    } catch (error) {
        logHandledError('Error al enviar notificación push manual', error);
        res.status(500).send("Error interno del servidor");
    }
};

const descargarNotificacionDocumento = async (req, res) => {
    const notificationId = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(notificationId)) {
        return res.status(400).send('Notificación inválida');
    }

    try {
        const notificacion = await notificaciones_MongooseModel.findById(notificationId);
        if (!notificacion?.url) {
            return res.status(404).send('Documento no encontrado');
        }

        const requesterRole = String(req.authz?.arquetipo || req.authUser?.arquetipo || req.authUser?.cargo || '').trim().toLowerCase();
        const requesterRut = String(req.authUser?.Rut || req.auth?.rut || '').trim();
        const canAccessAllNotifications = ['administracion', 'supervisor'].includes(requesterRole);

        if (!canAccessAllNotifications) {
            const trabajador = await trabajador_MongooseModel.findOne({ Rut: { $eq: requesterRut } });
            const workerId = trabajador?._id?.toString();
            const assignedWorkers = (notificacion.trabajadores || []).map((id) => id.toString());
            if (!workerId || !assignedWorkers.includes(workerId)) {
                return res.status(403).send('Permisos insuficientes');
            }
        }

        const companyDocument = notificacion.documentoEmpresa
            ? await DocumentoEmpresa.findById(notificacion.documentoEmpresa)
            : null;
        const safeFileName = path.basename(String(companyDocument?.archivo?.nombreOriginal || notificacion.url));
        const uploadPath = companyDocument
            ? resolveCompanyDocumentPath(companyDocument.archivo.rutaRelativa)
            : resolveNotificationAttachmentPath(notificacion.url);
        if (!uploadPath) {
            return res.status(404).send('Documento no encontrado');
        }

        const documento = notificacion.documento
            ? await documentos_MongooseModel.findById(notificacion.documento).select('formato')
            : null;
        const mimeType = getNotificationAttachmentMimeType(
            companyDocument?.archivo?.mimeType || documento?.formato,
            uploadPath
        ) || 'application/octet-stream';
        if (isNotificationImageMimeType(mimeType)) {
            const inlineFileName = safeFileName.replace(/["\r\n]/g, '_');
            return res.sendFile(uploadPath, {
                headers: {
                    'Content-Type': mimeType,
                    'Content-Disposition': `inline; filename="${inlineFileName}"`,
                },
            });
        }

        return res.download(uploadPath, safeFileName);
    } catch (error) {
        logHandledError(`Error al descargar documento de la notificación ${notificationId}`, error);
        return res.status(500).send('Error interno del servidor');
    }
};

module.exports = {
    buscarNotificacion,
    crearNotificacion,
    eliminarNotificacion,
    obtenerNotificaciones,
    detallesNotificacion,
    infoNotificaciones,
    pushNotification,
    createNotificationRecord,
    createSignatureValidations,
    createSystemNotificationForWorkers,
    createCompanyDocumentSignatureNotification,
    dispatchDueScheduledNotifications,
    pushNotificationOLD,
    crearNotificacionDocumento,
    obtenerNotificacionesDelUser,
    obtenerNotificacionesDelUserPaginadas,
    descargarNotificacionDocumento,
    firmarValidacionNotificacion,
    aceptarValidacionNotificacion,
    regenerarCodigoValidacion,
};
