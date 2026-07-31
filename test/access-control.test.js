const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ADMIN_REQUIRED_PERMISSIONS,
    ALL_PERMISSION_KEYS,
    ARCHETYPE_DEFAULTS,
    PERMISSION_DEFINITIONS,
} = require('../src/config/accessControl.js');
const {
    requireAnyPermission,
    requirePermission,
    requireRole,
} = require('../src/middlewares/auth.middleware.js');
const { canUseTemporaryRole, enforceAdminPermissions } = require('../src/services/accessControl.service.js');

const createResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.payload = payload;
        return this;
    },
});

test('permission catalog has unique stable keys and admin receives all permissions', () => {
    const keys = PERMISSION_DEFINITIONS.map(({ clave }) => clave);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(ARCHETYPE_DEFAULTS.administracion, ALL_PERMISSION_KEYS);
    assert.equal(ARCHETYPE_DEFAULTS.lector.length, 0);
    assert.equal(ARCHETYPE_DEFAULTS.inspector.length, 0);
});

test('administration roles cannot lose protected access-control permissions', () => {
    const permissions = enforceAdminPermissions('administracion', ['panel.ver']);
    assert.ok(permissions.includes('panel.ver'));
    ADMIN_REQUIRED_PERMISSIONS.forEach((permission) => assert.ok(permissions.includes(permission)));

    assert.deepEqual(enforceAdminPermissions('supervisor', ['panel.ver']), ['panel.ver']);
});

test('requirePermission accepts all requested permissions and rejects incomplete access', () => {
    const middleware = requirePermission('trabajadores.ver', 'trabajadores.editar');
    let nextCalls = 0;
    middleware({ authz: { permisos: ['trabajadores.ver', 'trabajadores.editar'] } }, createResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);

    const response = createResponse();
    middleware({ authz: { permisos: ['trabajadores.ver'] } }, response, () => { nextCalls += 1; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalls, 1);
});

test('requireAnyPermission accepts one matching permission', () => {
    const middleware = requireAnyPermission('accesos.ver', 'notificaciones.crear');
    let allowed = false;
    middleware({ authz: { permisos: ['notificaciones.crear'] } }, createResponse(), () => { allowed = true; });
    assert.equal(allowed, true);
});

test('legacy requireRole reads the resolved operational archetype', () => {
    const middleware = requireRole('supervisor');
    let allowed = false;
    middleware({ authz: { arquetipo: 'supervisor' }, authUser: { cargo: 'lector' } }, createResponse(), () => { allowed = true; });
    assert.equal(allowed, true);
});

test('temporary roles require the same archetype and a future expiration', () => {
    const now = new Date('2026-06-22T10:00:00.000Z').getTime();
    assert.equal(canUseTemporaryRole({
        role: { activo: true, arquetipo: 'supervisor' },
        permanentArchetype: 'supervisor',
        expiresAt: '2026-06-22T11:00:00.000Z',
        now,
    }), true);
    assert.equal(canUseTemporaryRole({
        role: { activo: true, arquetipo: 'administracion' },
        permanentArchetype: 'supervisor',
        expiresAt: '2026-06-22T11:00:00.000Z',
        now,
    }), false);
    assert.equal(canUseTemporaryRole({
        role: { activo: true, arquetipo: 'supervisor' },
        permanentArchetype: 'supervisor',
        expiresAt: '2026-06-22T09:00:00.000Z',
        now,
    }), false);
});
