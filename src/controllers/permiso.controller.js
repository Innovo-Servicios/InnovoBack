const { Permiso } = require('../models/permiso.model.js');

const serializePermission = (permission) => ({
    id: String(permission._id),
    clave: permission.clave,
    modulo: permission.modulo,
    accion: permission.accion,
    nombre: permission.nombre,
    descripcion: permission.descripcion || '',
    orden: permission.orden || 0,
    activo: permission.activo !== false,
});

const obtenerCatalogo = async (_req, res) => {
    try {
        const permissions = await Permiso.find({
            clave: { $exists: true },
            activo: { $ne: false },
        }).sort({ orden: 1, modulo: 1, accion: 1 });
        return res.json(permissions.map(serializePermission));
    } catch (error) {
        console.error('Error al listar permisos:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const actualizarPermiso = async (req, res) => {
    const { clave } = req.params;
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : undefined;
    const descripcion = typeof req.body.descripcion === 'string' ? req.body.descripcion.trim() : undefined;

    if (nombre !== undefined && nombre.length < 2) {
        return res.status(400).json({ message: 'El nombre es inválido' });
    }

    try {
        const update = {};
        if (nombre !== undefined) update.nombre = nombre;
        if (descripcion !== undefined) update.descripcion = descripcion;
        const permission = await Permiso.findOneAndUpdate(
            { clave: String(clave).trim().toLowerCase(), activo: { $ne: false } },
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!permission) return res.status(404).json({ message: 'Permiso no encontrado' });
        return res.json(serializePermission(permission));
    } catch (error) {
        console.error('Error al actualizar permiso:', error.message);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Adaptador heredado de solo lectura.
const obtenerPermisos = async (req, res) => obtenerCatalogo(req, res);
const crearPermiso = (_req, res) => res.status(409).json({
    message: 'El catálogo de permisos es administrado por el sistema',
});
const eliminarPermiso = crearPermiso;

module.exports = {
    actualizarPermiso,
    crearPermiso,
    eliminarPermiso,
    obtenerCatalogo,
    obtenerPermisos,
};
