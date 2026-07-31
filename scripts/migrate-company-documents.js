const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config();

const { ArquetipoRol } = require('../src/models/arquetipoRol.model.js');
const { CategoriaDocumentoEmpresa } = require('../src/models/categoriaDocumentoEmpresa.model.js');
const { DocumentoEmpresa } = require('../src/models/documentoEmpresa.model.js');
const { notificacion_validacion_MongooseModel: NotificacionValidacion } = require('../src/models/notificacion_validacion.model.js');
const { Permiso } = require('../src/models/permiso.model.js');
const { Rol } = require('../src/models/rol.model.js');
const { ensureAccessControlCatalog } = require('../src/services/accessControl.service.js');
const { COMPANY_DOCUMENTS_ROOT } = require('../src/services/companyDocuments.service.js');

const apply = process.argv.includes('--apply');
const PERMISSIONS = [
    'documentos_empresa.ver',
    'documentos_empresa.gestionar',
    'documentos_empresa.firmas.gestionar',
    'documentos_empresa.categorias.gestionar',
];

const buildUri = () => {
    const authSource = process.env.MONGO_AUTH_SOURCE
        ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}`
        : '';
    return `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;
};

const snapshot = async () => ({
    createdAt: new Date().toISOString(),
    permissions: await Permiso.find({ clave: { $in: PERMISSIONS } }).lean(),
    archetypes: await ArquetipoRol.find({ clave: { $in: ['administracion', 'supervisor'] } }).lean(),
    roles: await Rol.find({ arquetipo: { $in: ['administracion', 'supervisor'] }, legado: { $ne: true } }).lean(),
    companyDocuments: await DocumentoEmpresa.find().lean(),
});

const writeBackup = async (data) => {
    const directory = path.resolve(__dirname, '../storage/backups/company-documents');
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' });
    return filePath;
};

const migrate = async () => {
    await mongoose.connect(buildUri());
    const before = await snapshot();
    const existingKeys = new Set(before.permissions.map(({ clave }) => clave));
    const permissionIdByKey = new Map(before.permissions.map((permission) => [
        permission.clave,
        String(permission._id),
    ]));
    const adminPermissionIds = PERMISSIONS.map((key) => permissionIdByKey.get(key)).filter(Boolean);
    const supervisorPermissionId = permissionIdByKey.get('documentos_empresa.ver');
    const isMissingAny = (document, requiredIds) => {
        const current = new Set((document.permisos || document.permisosPredeterminados || []).map(String));
        return requiredIds.some((id) => !current.has(id));
    };
    const summary = {
        mode: apply ? 'apply' : 'dry-run',
        permissionsToCreate: PERMISSIONS.filter((key) => !existingKeys.has(key)).length,
        administrationRolesToUpdate: before.roles.filter((role) =>
            role.arquetipo === 'administracion' &&
            (adminPermissionIds.length < PERMISSIONS.length || isMissingAny(role, adminPermissionIds))
        ).length,
        supervisorRolesToUpdate: before.roles.filter((role) =>
            role.arquetipo === 'supervisor' &&
            (!supervisorPermissionId || isMissingAny(role, [supervisorPermissionId]))
        ).length,
        globalDocumentsToMigrate: before.companyDocuments.filter((document) =>
            document.alcance === 'global' && document.esGlobal !== true
        ).length,
        internalDocumentsToMigrate: before.companyDocuments.filter((document) =>
            document.alcance !== 'global' && document.esGlobal === undefined
        ).length,
        legacyVisibilityFieldsToRemove: before.companyDocuments.filter((document) =>
            document.alcance !== undefined
        ).length,
    };
    if (!apply) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    const backupPath = await writeBackup(before);
    await ensureAccessControlCatalog();
    const permissions = await Permiso.find({ clave: { $in: PERMISSIONS } });
    const permissionByKey = new Map(permissions.map((permission) => [permission.clave, permission._id]));
    const adminIds = PERMISSIONS.map((key) => permissionByKey.get(key)).filter(Boolean);
    const supervisorIds = [permissionByKey.get('documentos_empresa.ver')].filter(Boolean);

    const migrateDocumentVisibility = async () => {
        await DocumentoEmpresa.collection.updateMany(
            { alcance: 'global' },
            { $set: { esGlobal: true } }
        );
        await DocumentoEmpresa.collection.updateMany(
            { esGlobal: { $exists: false } },
            { $set: { esGlobal: false } }
        );
        await DocumentoEmpresa.collection.updateMany(
            { alcance: { $exists: true } },
            { $unset: { alcance: '' } }
        );
    };

    await Promise.all([
        ArquetipoRol.updateOne({ clave: 'administracion' }, { $addToSet: { permisosPredeterminados: { $each: adminIds } } }),
        ArquetipoRol.updateOne({ clave: 'supervisor' }, { $addToSet: { permisosPredeterminados: { $each: supervisorIds } } }),
        Rol.updateMany(
            { arquetipo: 'administracion', activo: true, legado: { $ne: true } },
            { $addToSet: { permisos: { $each: adminIds } } }
        ),
        Rol.updateMany(
            { arquetipo: 'supervisor', activo: true, legado: { $ne: true } },
            { $addToSet: { permisos: { $each: supervisorIds } } }
        ),
        fs.mkdir(COMPANY_DOCUMENTS_ROOT, { recursive: true }),
        migrateDocumentVisibility(),
    ]);
    await Promise.all([
        CategoriaDocumentoEmpresa.createIndexes(),
        DocumentoEmpresa.createIndexes(),
        NotificacionValidacion.createIndexes(),
    ]);

    console.log(JSON.stringify({ ...summary, backupPath, storagePath: COMPANY_DOCUMENTS_ROOT }, null, 2));
};

migrate()
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
