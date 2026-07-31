const ARCHETYPES = Object.freeze({
    ADMINISTRACION: 'administracion',
    SUPERVISOR: 'supervisor',
    INSPECTOR: 'inspector',
    LECTOR: 'lector',
});

const PERMISSION_DEFINITIONS = Object.freeze([
    ['panel.ver', 'Panel', 'ver', 'Ver panel'],
    ['panel.bot.gestionar', 'Panel', 'gestionar', 'Gestionar bot'],
    ['asignaciones.ver', 'Asignaciones', 'ver', 'Ver asignaciones'],
    ['asignaciones.crear', 'Asignaciones', 'crear', 'Crear asignaciones'],
    ['asignaciones.editar', 'Asignaciones', 'editar', 'Editar asignaciones'],
    ['asignaciones.configurar', 'Asignaciones', 'configurar', 'Configurar creador de asignaciones'],
    ['asignaciones.importar', 'Asignaciones', 'importar', 'Importar asignaciones'],
    ['asignaciones.exportar', 'Asignaciones', 'exportar', 'Exportar asignaciones'],
    ['trabajadores.ver', 'Trabajadores', 'ver', 'Ver trabajadores'],
    ['trabajadores.crear', 'Trabajadores', 'crear', 'Crear trabajadores'],
    ['trabajadores.editar', 'Trabajadores', 'editar', 'Editar trabajadores'],
    ['trabajadores.eliminar', 'Trabajadores', 'eliminar', 'Eliminar trabajadores'],
    ['trabajadores.roles.asignar', 'Trabajadores', 'asignar', 'Asignar roles permanentes'],
    ['trabajadores.roles.temporales', 'Trabajadores', 'asignar', 'Asignar roles temporales'],
    ['trabajadores.documentos.gestionar', 'Trabajadores', 'gestionar', 'Gestionar documentos'],
    ['trabajadores.apoyos.gestionar', 'Trabajadores', 'gestionar', 'Gestionar apoyos'],
    ['seguimiento.ver', 'Seguimiento', 'ver', 'Ver seguimiento'],
    ['notificaciones.ver', 'Notificaciones', 'ver', 'Ver notificaciones'],
    ['notificaciones.crear', 'Notificaciones', 'crear', 'Crear notificaciones'],
    ['notificaciones.eliminar', 'Notificaciones', 'eliminar', 'Eliminar notificaciones'],
    ['notificaciones.validaciones.gestionar', 'Notificaciones', 'gestionar', 'Gestionar validaciones'],
    ['novedades.ver', 'Novedades', 'ver', 'Ver novedades'],
    ['novedades.crear', 'Novedades', 'crear', 'Crear novedades'],
    ['novedades.editar', 'Novedades', 'editar', 'Editar novedades'],
    ['novedades.eliminar', 'Novedades', 'eliminar', 'Eliminar novedades'],
    ['novedades.exportar', 'Novedades', 'exportar', 'Exportar novedades'],
    ['ate.ver', 'ATE', 'ver', 'Ver atenciones especiales'],
    ['ate.asignar', 'ATE', 'asignar', 'Asignar atenciones especiales'],
    ['ate.editar', 'ATE', 'editar', 'Editar atenciones especiales'],
    ['ate.exportar', 'ATE', 'exportar', 'Exportar atenciones especiales'],
    ['validaciones_terreno.ver', 'Validaciones de terreno', 'ver', 'Ver validaciones de terreno'],
    ['validaciones_terreno.configurar', 'Validaciones de terreno', 'configurar', 'Configurar validaciones de terreno'],
    ['rutas.ver', 'Rutas', 'ver', 'Ver rutas'],
    ['rutas.gestionar', 'Rutas', 'gestionar', 'Gestionar rutas'],
    ['sectores.ver', 'Sectores', 'ver', 'Ver sectores'],
    ['sectores.gestionar', 'Sectores', 'gestionar', 'Gestionar sectores'],
    ['direcciones.ver', 'Direcciones', 'ver', 'Ver direcciones'],
    ['direcciones.gestionar', 'Direcciones', 'gestionar', 'Gestionar direcciones'],
    ['direcciones.comentar', 'Direcciones', 'comentar', 'Comentar direcciones'],
    ['clientes.ver', 'Clientes', 'ver', 'Ver clientes'],
    ['clientes.gestionar', 'Clientes', 'gestionar', 'Gestionar clientes'],
    ['medidores.ver', 'Medidores', 'ver', 'Ver medidores'],
    ['medidores.gestionar', 'Medidores', 'gestionar', 'Gestionar medidores'],
    ['catalogos.ver', 'Catálogos', 'ver', 'Ver catálogos'],
    ['catalogos.gestionar', 'Catálogos', 'gestionar', 'Gestionar catálogos'],
    ['documentos_empresa.ver', 'Documentos empresariales', 'ver', 'Ver documentos empresariales'],
    ['documentos_empresa.gestionar', 'Documentos empresariales', 'gestionar', 'Gestionar documentos empresariales'],
    ['documentos_empresa.firmas.gestionar', 'Documentos empresariales', 'gestionar', 'Gestionar firmas de documentos empresariales'],
    ['documentos_empresa.categorias.gestionar', 'Documentos empresariales', 'gestionar', 'Gestionar categorías documentales'],
    ['accesos.ver', 'Accesos', 'ver', 'Ver roles y permisos'],
    ['accesos.gestionar', 'Accesos', 'gestionar', 'Gestionar roles, arquetipos y permisos'],
].map(([clave, modulo, accion, nombre], orden) => ({
    clave,
    modulo,
    accion,
    nombre,
    descripcion: nombre,
    orden,
})));

const ALL_PERMISSION_KEYS = Object.freeze(PERMISSION_DEFINITIONS.map(({ clave }) => clave));

const SUPERVISOR_PERMISSION_KEYS = Object.freeze(ALL_PERMISSION_KEYS.filter((clave) =>
    ![
        'trabajadores.crear',
        'trabajadores.editar',
        'trabajadores.eliminar',
        'trabajadores.roles.asignar',
        'trabajadores.roles.temporales',
        'catalogos.gestionar',
        'documentos_empresa.gestionar',
        'documentos_empresa.firmas.gestionar',
        'documentos_empresa.categorias.gestionar',
        'accesos.ver',
        'accesos.gestionar',
    ].includes(clave)
));

const ARCHETYPE_DEFAULTS = Object.freeze({
    [ARCHETYPES.ADMINISTRACION]: ALL_PERMISSION_KEYS,
    [ARCHETYPES.SUPERVISOR]: SUPERVISOR_PERMISSION_KEYS,
    [ARCHETYPES.INSPECTOR]: [],
    [ARCHETYPES.LECTOR]: [],
});

const ARCHETYPE_LABELS = Object.freeze({
    [ARCHETYPES.ADMINISTRACION]: 'Administración',
    [ARCHETYPES.SUPERVISOR]: 'Supervisor',
    [ARCHETYPES.INSPECTOR]: 'Inspector',
    [ARCHETYPES.LECTOR]: 'Lector',
});

const ADMIN_REQUIRED_PERMISSIONS = Object.freeze(['accesos.ver', 'accesos.gestionar']);

module.exports = {
    ADMIN_REQUIRED_PERMISSIONS,
    ALL_PERMISSION_KEYS,
    ARCHETYPES,
    ARCHETYPE_DEFAULTS,
    ARCHETYPE_LABELS,
    PERMISSION_DEFINITIONS,
};
