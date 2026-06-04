const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUP_DIR = path.resolve(
    PROJECT_ROOT,
    'storage',
    'backups',
    'notification-history-purge'
);
const NOTIFICATION_DOCUMENT_TYPE = 'Notificacion';

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), quiet: true });

const NOTIFICATION_UPLOAD_DIRS = [
    path.join(PROJECT_ROOT, 'storage', 'uploads'),
    path.join(PROJECT_ROOT, 'uploads'),
    '/home/backend/Innovo-app/Backend/uploads',
    ...(process.env.NOTIFICATION_UPLOAD_DIRS || '')
        .split(',')
        .map((uploadDir) => uploadDir.trim())
        .filter(Boolean),
].map((uploadDir) => path.resolve(uploadDir));

const {
    notificaciones_MongooseModel: Notificacion,
} = require('../src/models/notificacion.model.js');
const {
    notificacion_vista_MongooseModel: NotificacionVista,
} = require('../src/models/notificacion_vista.model.js');
const {
    notificacion_validacion_MongooseModel: NotificacionValidacion,
} = require('../src/models/notificacion_validacion.model.js');
const {
    trabajador_MongooseModel: Trabajador,
} = require('../src/models/trabajador.model.js');
const {
    documentos_MongooseModel: Documento,
} = require('../src/models/documentos.model.js');
const {
    tipoDocumento_MongooseModel: TipoDocumento,
} = require('../src/models/tipoDocumento.model.js');

function printHelp() {
    console.log(`
Uso:
  bun scripts/purge-notification-history.js [--dry-run]
  bun scripts/purge-notification-history.js --apply
  bun scripts/purge-notification-history.js --verify

Opciones:
  --dry-run             Muestra el resumen sin modificar datos. Es el modo por defecto.
  --apply               Respalda y purga el historial de notificaciones.
  --verify              Verifica que la purga dejó la bandeja limpia.
  --backup-dir <path>   Carpeta para respaldos JSON y copias de adjuntos.
`);
}

function parseArgs(argv) {
    const args = {
        mode: 'dry-run',
        backupDir: DEFAULT_BACKUP_DIR,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--apply') {
            args.mode = 'apply';
        } else if (arg === '--dry-run') {
            args.mode = 'dry-run';
        } else if (arg === '--verify') {
            args.mode = 'verify';
        } else if (arg === '--backup-dir') {
            args.backupDir = path.resolve(argv[++i] || '');
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Argumento no reconocido: ${arg}`);
        }
    }

    return args;
}

function getMongoUri() {
    const required = [
        'MONGO_USER',
        'MONGO_PASSWORD',
        'MONGO_HOST',
        'MONGO_PORT',
        'MONGO_DATABASE',
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
        throw new Error(`Faltan variables de Mongo en .env: ${missing.join(', ')}`);
    }

    const authSource = process.env.MONGO_AUTH_SOURCE
        ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}`
        : '';

    return `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;
}

function timestampForPath() {
    return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function stringifyId(value) {
    return value == null ? null : String(value);
}

function isInsideAllowedUploadDir(filePath) {
    const resolvedPath = path.resolve(filePath);
    return NOTIFICATION_UPLOAD_DIRS.some(
        (uploadDir) =>
            resolvedPath === uploadDir || resolvedPath.startsWith(`${uploadDir}${path.sep}`)
    );
}

function findExistingAttachmentPath(storedPath) {
    if (!storedPath || /^https?:\/\//i.test(String(storedPath))) {
        return null;
    }

    const value = String(storedPath);
    const candidates = [];

    if (path.isAbsolute(value)) {
        candidates.push(path.resolve(value));
    }

    const safeFileName = path.basename(value);
    if (safeFileName) {
        for (const uploadDir of NOTIFICATION_UPLOAD_DIRS) {
            candidates.push(path.join(uploadDir, safeFileName));
        }
    }

    return [...new Set(candidates)].find((candidate) => {
        const resolvedPath = path.resolve(candidate);
        return isInsideAllowedUploadDir(resolvedPath) && fs.existsSync(resolvedPath);
    }) || null;
}

function getNotificationDocumentIds(notifications, notificationDocuments) {
    const ids = new Set();

    for (const notification of notifications) {
        if (notification.documento) {
            ids.add(stringifyId(notification.documento));
        }
    }

    for (const document of notificationDocuments) {
        ids.add(stringifyId(document._id));
    }

    return [...ids].filter(Boolean);
}

function getAttachmentFiles(notifications, notificationDocuments) {
    const filesByPath = new Map();
    const skipped = [];
    const addCandidate = (source, storedPath) => {
        if (!storedPath) {
            return;
        }

        const filePath = findExistingAttachmentPath(storedPath);
        if (!filePath) {
            skipped.push({ source, storedPath, reason: 'No existe o no esta en una ruta permitida' });
            return;
        }

        filesByPath.set(filePath, { source, storedPath, filePath });
    };

    for (const notification of notifications) {
        addCandidate(`notificacion:${notification._id}`, notification.url);
    }

    for (const document of notificationDocuments) {
        addCandidate(`documento:${document._id}`, document.url);
    }

    return {
        files: [...filesByPath.values()],
        skipped,
    };
}

async function loadPurgeSnapshot() {
    const notificationType = await TipoDocumento.findOne({
        value: NOTIFICATION_DOCUMENT_TYPE,
    }).lean();
    const [
        notifications,
        views,
        validations,
        notificationDocuments,
        workersWithNotificationState,
    ] = await Promise.all([
        Notificacion.find().lean(),
        NotificacionVista.find().lean(),
        NotificacionValidacion.find().lean(),
        notificationType
            ? Documento.find({ tipo: notificationType._id }).lean()
            : Promise.resolve([]),
        Trabajador.find({
            $or: [
                { notificaciones: { $exists: true, $ne: [] } },
                { vistas: { $exists: true, $ne: [] } },
                { notificacionesEliminadas: { $exists: true, $ne: [] } },
                { documentos: { $exists: true, $ne: [] } },
            ],
        })
            .select('Rut Nombre cargo notificaciones vistas notificacionesEliminadas documentos')
            .lean(),
    ]);

    const notificationIds = notifications.map((notification) => stringifyId(notification._id));
    const notificationDocumentIds = getNotificationDocumentIds(
        notifications,
        notificationDocuments
    );
    const attachmentFiles = getAttachmentFiles(notifications, notificationDocuments);

    return {
        notificationType,
        notifications,
        views,
        validations,
        notificationDocuments,
        workersWithNotificationState,
        notificationIds,
        notificationDocumentIds,
        attachmentFiles,
    };
}

function countWorkerRefs(workers, notificationIds, notificationDocumentIds) {
    const notificationIdSet = new Set(notificationIds);
    const documentIdSet = new Set(notificationDocumentIds);

    return workers.reduce(
        (acc, worker) => {
            const notificaciones = worker.notificaciones || [];
            const vistas = worker.vistas || [];
            const eliminadas = worker.notificacionesEliminadas || [];
            const documentos = worker.documentos || [];

            acc.notificationRefs += notificaciones.filter((id) =>
                notificationIdSet.has(stringifyId(id))
            ).length;
            acc.viewRefs += vistas.filter((id) =>
                notificationIdSet.has(stringifyId(id))
            ).length;
            acc.deletedRefs += eliminadas.filter((id) =>
                notificationIdSet.has(stringifyId(id))
            ).length;
            acc.notificationDocumentRefs += documentos.filter((id) =>
                documentIdSet.has(stringifyId(id))
            ).length;

            if (
                notificaciones.length ||
                vistas.length ||
                eliminadas.length ||
                documentos.some((id) => documentIdSet.has(stringifyId(id)))
            ) {
                acc.workersWithRefs += 1;
            }

            return acc;
        },
        {
            workersWithRefs: 0,
            notificationRefs: 0,
            viewRefs: 0,
            deletedRefs: 0,
            notificationDocumentRefs: 0,
        }
    );
}

function buildSummary(snapshot) {
    return {
        notificaciones: snapshot.notifications.length,
        vistas: snapshot.views.length,
        validaciones: snapshot.validations.length,
        documentosTipoNotificacion: snapshot.notificationDocuments.length,
        documentosRelacionadosANotificaciones: snapshot.notificationDocumentIds.length,
        archivosAdjuntosEncontrados: snapshot.attachmentFiles.files.length,
        archivosAdjuntosOmitidos: snapshot.attachmentFiles.skipped.length,
        trabajadores: countWorkerRefs(
            snapshot.workersWithNotificationState,
            snapshot.notificationIds,
            snapshot.notificationDocumentIds
        ),
    };
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function copyAttachmentFiles(files, backupPath) {
    const filesBackupDir = path.join(backupPath, 'files');
    const copied = [];

    for (const file of files) {
        const targetPath = path.join(
            filesBackupDir,
            `${copied.length + 1}-${path.basename(file.filePath)}`
        );
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(file.filePath, targetPath);
        copied.push({
            ...file,
            backupPath: targetPath,
        });
    }

    return copied;
}

function createBackup(snapshot, backupRoot) {
    const backupPath = path.join(backupRoot, timestampForPath());
    fs.mkdirSync(backupPath, { recursive: true });

    const copiedFiles = copyAttachmentFiles(snapshot.attachmentFiles.files, backupPath);
    writeJson(path.join(backupPath, 'backup.json'), {
        createdAt: new Date().toISOString(),
        summary: buildSummary(snapshot),
        uploadDirs: NOTIFICATION_UPLOAD_DIRS,
        notificaciones: snapshot.notifications,
        notificacion_vista: snapshot.views,
        notificacion_validacion: snapshot.validations,
        documentosTipoNotificacion: snapshot.notificationDocuments,
        trabajadoresConReferencias: snapshot.workersWithNotificationState,
        archivosAdjuntos: {
            copied: copiedFiles,
            skipped: snapshot.attachmentFiles.skipped,
        },
    });

    return backupPath;
}

async function applyPurge(snapshot) {
    const notificationObjectIds = snapshot.notificationIds.map(
        (id) => new mongoose.Types.ObjectId(id)
    );
    const documentObjectIds = snapshot.notificationDocumentIds.map(
        (id) => new mongoose.Types.ObjectId(id)
    );

    const updateWorkers = await Trabajador.updateMany(
        {},
        {
            $set: {
                notificaciones: [],
                vistas: [],
                notificacionesEliminadas: [],
            },
            ...(documentObjectIds.length
                ? { $pull: { documentos: { $in: documentObjectIds } } }
                : {}),
        }
    );

    const [deleteViews, deleteValidations, deleteNotifications, deleteDocuments] =
        await Promise.all([
            NotificacionVista.deleteMany({}),
            NotificacionValidacion.deleteMany({}),
            notificationObjectIds.length
                ? Notificacion.deleteMany({ _id: { $in: notificationObjectIds } })
                : Promise.resolve({ deletedCount: 0 }),
            documentObjectIds.length
                ? Documento.deleteMany({ _id: { $in: documentObjectIds } })
                : Promise.resolve({ deletedCount: 0 }),
        ]);

    const deletedFiles = [];
    const fileErrors = [];
    for (const file of snapshot.attachmentFiles.files) {
        try {
            if (fs.existsSync(file.filePath)) {
                fs.unlinkSync(file.filePath);
                deletedFiles.push(file.filePath);
            }
        } catch (error) {
            fileErrors.push({
                filePath: file.filePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        updateWorkers: {
            matchedCount: updateWorkers.matchedCount,
            modifiedCount: updateWorkers.modifiedCount,
        },
        deleteViews: deleteViews.deletedCount,
        deleteValidations: deleteValidations.deletedCount,
        deleteNotifications: deleteNotifications.deletedCount,
        deleteDocuments: deleteDocuments.deletedCount,
        deletedFiles,
        fileErrors,
    };
}

async function buildVerification() {
    const notificationType = await TipoDocumento.findOne({
        value: NOTIFICATION_DOCUMENT_TYPE,
    }).lean();
    const notificationDocumentFilter = notificationType
        ? { tipo: notificationType._id }
        : { _id: { $exists: false } };

    const [
        notificaciones,
        vistas,
        validaciones,
        documentosTipoNotificacion,
        workersWithNotificationRefs,
        workersWithNotificationDocs,
    ] = await Promise.all([
        Notificacion.countDocuments(),
        NotificacionVista.countDocuments(),
        NotificacionValidacion.countDocuments(),
        Documento.countDocuments(notificationDocumentFilter),
        Trabajador.countDocuments({
            $or: [
                { notificaciones: { $exists: true, $ne: [] } },
                { vistas: { $exists: true, $ne: [] } },
                { notificacionesEliminadas: { $exists: true, $ne: [] } },
            ],
        }),
        notificationType
            ? Trabajador.countDocuments({
                documentos: {
                    $in: await Documento.find(notificationDocumentFilter).distinct('_id'),
                },
            })
            : Promise.resolve(0),
    ]);

    return {
        notificaciones,
        vistas,
        validaciones,
        documentosTipoNotificacion,
        trabajadoresConReferenciasNotificacion: workersWithNotificationRefs,
        trabajadoresConDocumentosNotificacion: workersWithNotificationDocs,
        ok:
            notificaciones === 0 &&
            vistas === 0 &&
            validaciones === 0 &&
            documentosTipoNotificacion === 0 &&
            workersWithNotificationRefs === 0 &&
            workersWithNotificationDocs === 0,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await mongoose.connect(getMongoUri());

    if (args.mode === 'verify') {
        const verification = await buildVerification();
        console.log(JSON.stringify({ mode: 'verify', verification }, null, 2));
        if (!verification.ok) {
            process.exitCode = 1;
        }
        return;
    }

    const snapshot = await loadPurgeSnapshot();
    const summary = buildSummary(snapshot);

    if (args.mode === 'dry-run') {
        console.log(JSON.stringify({ mode: 'dry-run', summary }, null, 2));
        return;
    }

    const backupPath = createBackup(snapshot, args.backupDir);
    const result = await applyPurge(snapshot);
    const verification = await buildVerification();

    writeJson(path.join(backupPath, 'result.json'), {
        appliedAt: new Date().toISOString(),
        result,
        verification,
    });

    console.log(JSON.stringify({
        mode: 'apply',
        backupPath,
        summary,
        result,
        verification,
    }, null, 2));

    if (!verification.ok || result.fileErrors.length > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
