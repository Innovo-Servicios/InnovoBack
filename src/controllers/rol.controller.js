const mongoose = require('mongoose');
const { ArquetipoRol } = require('../models/arquetipoRol.model.js');
const { Rol } = require('../models/rol.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model.js');
const {
    resolvePermissionIds,
} = require('../services/accessControl.service.js');

const normalizeName = (value) => String(value || '').trim();
const serializeRole = (role, assignedCount = 0) => ({
    id: String(role._id),
    nombre: role.nombre,
    descripcion: role.descripcion || '',
    arquetipo: role.arquetipo,
    permisos: (role.permisos || []).map((permission) => permission?.clave).filter(Boolean),
    activo: role.activo !== false,
    esBase: Boolean(role.esBase),
    asignados: assignedCount,
});

const serializeArchetype = (archetype) => ({
    clave: archetype.clave,
    nombre: archetype.nombre,
    descripcion: archetype.descripcion || '',
    permisosPredeterminados: (archetype.permisosPredeterminados || [])
        .map((permission) => permission?.clave)
        .filter(Boolean),
    activo: archetype.activo !== false,
});

const rolePopulate = {
    path: 'permisos',
    match: { activo: { $ne: false }, clave: { $exists: true } },
    select: 'clave modulo accion nombre descripcion orden',
};
const archetypePopulate = {
    path: 'permisosPredeterminados',
    match: { activo: { $ne: false }, clave: { $exists: true } },
    select: 'clave modulo accion nombre descripcion orden',
};

const listarRoles = async (_req, res) => {
    try {
        const [roles, counts] = await Promise.all([
            Rol.find({ legado: { $ne: true } }).populate(rolePopulate).sort({ activo: -1, nombre: 1 }),
            Trabajador.aggregate([{ $match: { rol: { $ne: null } } }, { $group: { _id: '$rol', count: { $sum: 1 } } }]),
        ]);
        const countByRole = new Map(counts.map(({ _id, count }) => [String(_id), count]));
        return res.json(roles.map((role) => serializeRole(role, countByRole.get(String(role._id)) || 0)));
    } catch (error) {
        console.error('Error al listar roles:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const listarArquetipos = async (_req, res) => {
    try {
        const archetypes = await ArquetipoRol.find({ activo: { $ne: false } })
            .populate(archetypePopulate)
            .sort({ nombre: 1 });
        return res.json(archetypes.map(serializeArchetype));
    } catch (error) {
        console.error('Error al listar arquetipos:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const actualizarArquetipo = async (req, res) => {
    const clave = String(req.params.clave || '').trim().toLowerCase();
    const permissionKeys = Array.isArray(req.body.permisosPredeterminados)
        ? req.body.permisosPredeterminados
        : [];
    try {
        const archetype = await ArquetipoRol.findOne({ clave, activo: { $ne: false } });
        if (!archetype) return res.status(404).json({ message: 'Arquetipo no encontrado' });

        archetype.nombre = normalizeName(req.body.nombre) || archetype.nombre;
        if (typeof req.body.descripcion === 'string') archetype.descripcion = req.body.descripcion.trim();
        archetype.permisosPredeterminados = await resolvePermissionIds(permissionKeys, clave);
        await archetype.save();
        await archetype.populate(archetypePopulate);
        return res.json(serializeArchetype(archetype));
    } catch (error) {
        console.error('Error al actualizar arquetipo:', error.message);
        return res.status(error.status || 500).json({ message: error.message || 'Error interno del servidor' });
    }
};

const crearRol = async (req, res) => {
    const nombre = normalizeName(req.body.nombre);
    const arquetipo = String(req.body.arquetipo || '').trim().toLowerCase();
    if (nombre.length < 2) return res.status(400).json({ message: 'El nombre es inválido' });

    try {
        const archetype = await ArquetipoRol.findOne({ clave: arquetipo, activo: { $ne: false } })
            .populate(archetypePopulate);
        if (!archetype) return res.status(400).json({ message: 'Arquetipo inválido' });
        const permissionKeys = Array.isArray(req.body.permisos)
            ? req.body.permisos
            : archetype.permisosPredeterminados.map(({ clave }) => clave);
        const role = new Rol({
            nombre,
            descripcion: normalizeName(req.body.descripcion),
            arquetipo,
            permisos: await resolvePermissionIds(permissionKeys, arquetipo),
            activo: true,
            esBase: false,
            legado: false,
        });
        await role.save();
        await role.populate(rolePopulate);
        req.io?.emit('control-acceso-actualizado', { tipo: 'roles' });
        return res.status(201).json(serializeRole(role));
    } catch (error) {
        const duplicate = error?.code === 11000;
        console.error('Error al crear rol:', error.message);
        return res.status(duplicate ? 409 : (error.status || 500)).json({
            message: duplicate ? 'Ya existe un rol con ese nombre' : error.message || 'Error interno del servidor',
        });
    }
};

const modificarRol = async (req, res) => {
    const id = req.params.id || req.body.id;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Rol inválido' });
    try {
        const role = await Rol.findById(id);
        if (!role || role.legado) return res.status(404).json({ message: 'Rol no encontrado' });
        const nombre = normalizeName(req.body.nombre);
        if (nombre) role.nombre = nombre;
        if (typeof req.body.descripcion === 'string') role.descripcion = req.body.descripcion.trim();
        if (Array.isArray(req.body.permisos)) {
            role.permisos = await resolvePermissionIds(req.body.permisos, role.arquetipo);
        }
        await role.save();
        await role.populate(rolePopulate);
        req.io?.emit('control-acceso-actualizado', { tipo: 'rol', rolId: String(role._id) });
        return res.json(serializeRole(role));
    } catch (error) {
        const duplicate = error?.code === 11000;
        console.error('Error al modificar rol:', error.message);
        return res.status(duplicate ? 409 : (error.status || 500)).json({
            message: duplicate ? 'Ya existe un rol con ese nombre' : error.message || 'Error interno del servidor',
        });
    }
};

const archivarRol = async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Rol inválido' });
    try {
        const role = await Rol.findById(id);
        if (!role || role.legado) return res.status(404).json({ message: 'Rol no encontrado' });
        const assigned = await Trabajador.countDocuments({ $or: [{ rol: role._id }, { 'rolTemporal.rol': role._id }] });
        if (assigned > 0) return res.status(409).json({ message: 'Reasigna los trabajadores antes de archivar este rol' });
        if (role.arquetipo === 'administracion') {
            const remaining = await Rol.countDocuments({
                _id: { $ne: role._id }, arquetipo: 'administracion', activo: true, legado: { $ne: true },
            });
            if (remaining === 0) return res.status(409).json({ message: 'Debe existir al menos un rol administrativo activo' });
        }
        role.activo = false;
        await role.save();
        req.io?.emit('control-acceso-actualizado', { tipo: 'roles' });
        return res.status(204).send();
    } catch (error) {
        console.error('Error al archivar rol:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const asignarRol = async (req, res) => {
    const trabajadorId = req.params.trabajadorId || req.body.objetivo;
    const roleId = req.body.rolId || req.body.rol;
    if (!mongoose.isValidObjectId(trabajadorId) || !mongoose.isValidObjectId(roleId)) {
        return res.status(400).json({ message: 'Trabajador o rol inválido' });
    }
    try {
        const [worker, role] = await Promise.all([
            Trabajador.findById(trabajadorId),
            Rol.findOne({ _id: roleId, activo: true, legado: { $ne: true } }),
        ]);
        if (!worker) return res.status(404).json({ message: 'Trabajador no encontrado' });
        if (!role) return res.status(404).json({ message: 'Rol no encontrado' });
        worker.rol = role._id;
        worker.arquetipo = role.arquetipo;
        worker.cargo = role.arquetipo;
        if (worker.rolTemporal?.rol) worker.rolTemporal = undefined;
        await worker.save();
        req.io?.to(`user:${worker._id}`).emit('control-acceso-actualizado', { tipo: 'asignacion' });
        req.io?.emit('updateWorker');
        return res.json({ message: 'Rol asignado', rol: serializeRole(role) });
    } catch (error) {
        console.error('Error al asignar rol:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const asignarRolTemporal = async (req, res) => {
    const { trabajadorId } = req.params;
    const { rolId, horas, expiracion } = req.body;
    if (!mongoose.isValidObjectId(trabajadorId) || !mongoose.isValidObjectId(rolId)) {
        return res.status(400).json({ message: 'Trabajador o rol inválido' });
    }
    const expiresAt = expiracion ? new Date(expiracion) : new Date(Date.now() + Number(horas) * 60 * 60 * 1000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'La expiración debe estar en el futuro' });
    }
    try {
        const [worker, role] = await Promise.all([
            Trabajador.findById(trabajadorId),
            Rol.findOne({ _id: rolId, activo: true, legado: { $ne: true } }),
        ]);
        if (!worker || !role) return res.status(404).json({ message: 'Trabajador o rol no encontrado' });
        const workerArchetype = worker.arquetipo || worker.cargo;
        if (role.arquetipo !== workerArchetype) {
            return res.status(400).json({ message: 'El rol temporal debe pertenecer al mismo arquetipo' });
        }
        worker.rolTemporal = { rol: role._id, expiracion: expiresAt };
        await worker.save();
        req.io?.to(`user:${worker._id}`).emit('control-acceso-actualizado', { tipo: 'asignacion-temporal' });
        return res.json({ message: 'Rol temporal asignado', expiracion: expiresAt });
    } catch (error) {
        console.error('Error al asignar rol temporal:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const eliminarRolTemporal = async (req, res) => {
    try {
        const worker = await Trabajador.findById(req.params.trabajadorId);
        if (!worker) return res.status(404).json({ message: 'Trabajador no encontrado' });
        worker.rolTemporal = undefined;
        await worker.save();
        req.io?.to(`user:${worker._id}`).emit('control-acceso-actualizado', { tipo: 'asignacion-temporal' });
        return res.status(204).send();
    } catch (error) {
        console.error('Error al quitar rol temporal:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Adaptadores heredados.
const obtenerRoles = listarRoles;
const rolesTemporales = (req, res) => {
    req.params.trabajadorId = req.body.objetivo;
    req.body.rolId = req.body.rol;
    return asignarRolTemporal(req, res);
};
const darRol = (req, res) => {
    req.params.trabajadorId = req.body.objetivo;
    req.body.rolId = req.body.rol;
    return asignarRol(req, res);
};

module.exports = {
    actualizarArquetipo,
    archivarRol,
    asignarRol,
    asignarRolTemporal,
    crearRol,
    darRol,
    eliminarRolTemporal,
    listarArquetipos,
    listarRoles,
    modificarRol,
    obtenerRoles,
    rolesTemporales,
};
