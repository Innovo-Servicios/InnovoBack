const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config();

const { ensureAccessControlCatalog } = require('../src/services/accessControl.service.js');
const { ArquetipoRol } = require('../src/models/arquetipoRol.model.js');
const { Permiso } = require('../src/models/permiso.model.js');
const { Rol } = require('../src/models/rol.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../src/models/trabajador.model.js');

const apply = process.argv.includes('--apply');

const buildUri = () => {
    const authSource = process.env.MONGO_AUTH_SOURCE
        ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}`
        : '';
    return `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;
};

const snapshot = async () => {
    const [permissions, archetypes, roles, workers] = await Promise.all([
        Permiso.find().lean(),
        ArquetipoRol.find().lean(),
        Rol.find().lean(),
        Trabajador.find().select('_id Rut Nombre cargo arquetipo rol rolTemporal').lean(),
    ]);
    return { createdAt: new Date().toISOString(), permissions, archetypes, roles, workers };
};

const writeBackup = async (data) => {
    const directory = path.resolve(__dirname, '../storage/backups/access-control');
    await fs.mkdir(directory, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' });
    return filePath;
};

const migrate = async () => {
    await mongoose.connect(buildUri());
    const before = await snapshot();
    const legacyRoleIds = new Set(before.roles
        .filter((role) => !role.legado && (!role.arquetipo || !role.nombreNormalizado))
        .map((role) => String(role._id)));
    const workersToMigrate = before.workers.filter((worker) =>
        !worker.arquetipo || !worker.rol || legacyRoleIds.has(String(worker.rol))
    );

    const summary = {
        mode: apply ? 'apply' : 'dry-run',
        permissionsToArchive: before.permissions.filter((permission) => !permission.clave && !permission.legado).length,
        rolesToArchive: legacyRoleIds.size,
        workersToMigrate: workersToMigrate.length,
    };

    if (!apply) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    const backupPath = await writeBackup(before);
    const { archetypes } = await ensureAccessControlCatalog();
    const baseRoles = new Map();

    for (const archetype of archetypes) {
        const role = await Rol.findOneAndUpdate(
            { arquetipo: archetype.clave, esBase: true, legado: { $ne: true } },
            {
                $setOnInsert: {
                    nombre: `${archetype.nombre} base`,
                    nombreNormalizado: `${archetype.nombre} base`.toLocaleLowerCase('es-CL'),
                    descripcion: `Rol base generado desde ${archetype.nombre}`,
                    arquetipo: archetype.clave,
                    permisos: archetype.permisosPredeterminados,
                    activo: true,
                    esBase: true,
                    legado: false,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        baseRoles.set(archetype.clave, role);
    }

    for (const worker of workersToMigrate) {
        const archetype = String(worker.arquetipo || worker.cargo || 'lector').trim().toLowerCase();
        const baseRole = baseRoles.get(archetype) || baseRoles.get('lector');
        await Trabajador.updateOne(
            { _id: worker._id },
            {
                $set: {
                    rol: baseRole._id,
                    arquetipo: baseRole.arquetipo,
                    cargo: baseRole.arquetipo,
                },
                $unset: { rolTemporal: '' },
            }
        );
    }

    if (legacyRoleIds.size > 0) {
        await Rol.updateMany(
            { _id: { $in: [...legacyRoleIds] } },
            { $set: { activo: false, legado: true } }
        );
    }
    await Permiso.updateMany(
        { clave: { $exists: false } },
        { $set: { activo: false, legado: true } }
    );

    console.log(JSON.stringify({ ...summary, backupPath }, null, 2));
};

migrate()
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
