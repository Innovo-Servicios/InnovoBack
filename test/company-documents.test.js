const test = require('node:test');
const assert = require('node:assert/strict');

const {
    COMPANY_DOCUMENTS_ROOT,
    canAccessCompanyDocument,
    buildWorkerVisibleCompanyDocumentQuery,
    getExpirationMilestone,
    getExpirationStatus,
    isAllowedCompanyDocument,
    resolveInsideRoot,
    slugifyCategory,
} = require('../src/services/companyDocuments.service.js');
const {
    ARCHETYPE_DEFAULTS,
} = require('../src/config/accessControl.js');

test('company document category slugs are stable and filesystem-safe', () => {
    assert.equal(slugifyCategory('  Prevención y Seguridad  '), 'prevencion-y-seguridad');
    assert.equal(slugifyCategory('../../Contratos'), 'contratos');
    assert.equal(resolveInsideRoot('../../etc/passwd'), null);
    assert.equal(resolveInsideRoot('/../../etc/passwd'), null);
    assert.ok(resolveInsideRoot('contratos').startsWith(COMPANY_DOCUMENTS_ROOT));
});

test('company documents require an allowed extension and MIME type', () => {
    assert.equal(isAllowedCompanyDocument({
        originalname: 'procedimiento.pdf',
        mimetype: 'application/pdf',
    }), true);
    assert.equal(isAllowedCompanyDocument({
        originalname: 'procedimiento.exe',
        mimetype: 'application/pdf',
    }), false);
    assert.equal(isAllowedCompanyDocument({
        originalname: 'procedimiento.pdf',
        mimetype: 'application/x-msdownload',
    }), false);
});

test('expiration status and milestones use the configured early-warning window', () => {
    const now = new Date('2026-06-22T12:00:00.000Z');
    const base = { estado: 'vigente', diasAviso: 30 };

    assert.equal(getExpirationStatus({
        ...base,
        fechaVencimiento: '2026-08-01T12:00:00.000Z',
    }, now), 'vigente');
    assert.equal(getExpirationStatus({
        ...base,
        fechaVencimiento: '2026-06-29T12:00:00.000Z',
    }, now), 'por_vencer');
    assert.equal(getExpirationStatus({
        ...base,
        fechaVencimiento: '2026-06-21T12:00:00.000Z',
    }, now), 'vencido');

    assert.equal(getExpirationMilestone({
        fechaVencimiento: '2026-07-22T12:00:00.000Z',
        diasAviso: 30,
    }, now).level, 1);
    assert.equal(getExpirationMilestone({
        fechaVencimiento: '2026-06-29T12:00:00.000Z',
        diasAviso: 30,
    }, now).level, 2);
    assert.equal(getExpirationMilestone({
        fechaVencimiento: '2026-06-23T12:00:00.000Z',
        diasAviso: 30,
    }, now).level, 3);
    assert.equal(getExpirationMilestone({
        fechaVencimiento: '2026-06-21T12:00:00.000Z',
        diasAviso: 30,
    }, now).level, 4);
});

test('company document permissions follow the requested archetype defaults', () => {
    const companyPermissions = [
        'documentos_empresa.ver',
        'documentos_empresa.gestionar',
        'documentos_empresa.firmas.gestionar',
        'documentos_empresa.categorias.gestionar',
    ];

    companyPermissions.forEach((permission) => {
        assert.ok(ARCHETYPE_DEFAULTS.administracion.includes(permission));
    });
    assert.ok(ARCHETYPE_DEFAULTS.supervisor.includes('documentos_empresa.ver'));
    companyPermissions.slice(1).forEach((permission) => {
        assert.equal(ARCHETYPE_DEFAULTS.supervisor.includes(permission), false);
    });
    assert.equal(ARCHETYPE_DEFAULTS.inspector.includes('documentos_empresa.ver'), false);
    assert.equal(ARCHETYPE_DEFAULTS.lector.includes('documentos_empresa.ver'), false);
});

test('global documents are available to every authenticated worker without exposing internal files', () => {
    const workerId = 'worker-a';
    const globalDocument = { esGlobal: true, estado: 'vigente' };
    const archivedGlobalDocument = { esGlobal: true, estado: 'archivado' };
    const internalDocument = {
        esGlobal: false,
        estado: 'vigente',
        firmantesFisicos: [{ trabajador: 'worker-b' }],
        firmantesDigitales: [{ trabajador: workerId }],
    };

    assert.equal(canAccessCompanyDocument({ document: globalDocument, workerId }), true);
    assert.equal(canAccessCompanyDocument({ document: archivedGlobalDocument, workerId }), false);
    assert.equal(canAccessCompanyDocument({ document: internalDocument, workerId }), false);
    assert.equal(canAccessCompanyDocument({ document: internalDocument, workerId: 'worker-b' }), false);
    assert.equal(canAccessCompanyDocument({
        document: internalDocument,
        workerId,
        permissions: ['documentos_empresa.ver'],
    }), true);
});

test('worker document listing only queries active global company documents', () => {
    assert.deepEqual(buildWorkerVisibleCompanyDocumentQuery(), {
        esGlobal: true,
        estado: 'vigente',
    });
});
