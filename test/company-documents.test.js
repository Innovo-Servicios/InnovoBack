const test = require('node:test');
const assert = require('node:assert/strict');

const {
    COMPANY_DOCUMENTS_ROOT,
    buildDefaultApprovals,
    buildVersionedDocumentCode,
    canAccessCompanyDocument,
    buildWorkerVisibleCompanyDocumentQuery,
    getApprovalSummary,
    getDigitalSignatureSummary,
    getExpirationMilestone,
    getExpirationStatus,
    isAllowedCompanyDocument,
    normalizeDocumentCode,
    resolveInsideRoot,
    slugifyCategory,
} = require('../src/services/companyDocuments.service.js');
const {
    buildCompanyDocumentEvidence,
    buildEvidenceCsv,
} = require('../src/services/companyDocumentEvidence.service.js');
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

test('company document codes are normalized and versioned automatically', () => {
    assert.equal(normalizeDocumentCode(' sgi 001 prevención '), 'SGI-001-PREVENCION');
    assert.equal(buildVersionedDocumentCode('sgi-019-pt', 4), 'SGI-019-PT-V004');
    assert.equal(buildVersionedDocumentCode('', 1), '');
});

test('company document approval summary requires gerencia and prevencion', () => {
    const approvals = buildDefaultApprovals();
    assert.deepEqual(getApprovalSummary(approvals), {
        required: true,
        approved: false,
        pending: ['gerencia', 'prevencion'],
    });

    approvals[0].estado = 'aprobado';
    approvals[1].estado = 'aprobado';
    assert.deepEqual(getApprovalSummary(approvals), {
        required: true,
        approved: true,
        pending: [],
    });
    assert.deepEqual(getApprovalSummary([]), {
        required: false,
        approved: true,
        pending: [],
    });
});

test('company document digital signature summary follows validation states', () => {
    const signers = [
        { validacion: 'validation-1' },
        { validacion: 'validation-2' },
        { validacion: 'validation-3' },
        { validacion: 'validation-4' },
    ];
    const validationMap = new Map([
        ['validation-1', { estado: 'aceptado' }],
        ['validation-2', { estado: 'firmado' }],
        ['validation-3', { estado: 'vencido' }],
    ]);

    assert.deepEqual(getDigitalSignatureSummary(signers, validationMap), {
        total: 4,
        pendientes: 1,
        firmados: 1,
        aceptados: 1,
        vencidos: 1,
        bloqueados: 0,
    });
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

test('company document evidence summarizes delivery, view and signature records', () => {
    const evidence = buildCompanyDocumentEvidence({
        document: {
            _id: 'document-1',
            titulo: 'Procedimiento de seguridad',
            codigoBase: 'SGI-001',
            codigoVersionado: 'SGI-001-V001',
            version: 1,
            categoria: { nombre: 'Prevencion' },
            estado: 'vigente',
            fechaVencimiento: null,
            archivo: { nombreOriginal: 'procedimiento.pdf' },
            responsableSistemaGestion: { nombre: 'Paola Olivares', cargo: 'Prevencion de Riesgos' },
        },
        notifications: [{ _id: 'notification-1' }],
        validations: [
            {
                trabajador: 'worker-1',
                notificacion: 'notification-1',
                estado: 'aceptado',
                firmadoAt: '2026-07-30T20:00:00.000Z',
                aceptadoAt: '2026-07-30T20:01:00.000Z',
                expiresAt: '2026-08-06T20:00:00.000Z',
                intentos: 1,
            },
            {
                trabajador: 'worker-2',
                notificacion: 'notification-1',
                estado: 'pendiente',
                expiresAt: '2026-08-06T20:00:00.000Z',
                intentos: 0,
            },
        ],
        views: [{ trabajador: 'worker-1', createdAt: '2026-07-30T20:00:10.000Z' }],
        workers: [
            { _id: 'worker-1', Rut: '11.111.111-1', Nombre: 'Trabajador Uno', arquetipo: 'lector' },
            { _id: 'worker-2', Rut: '22.222.222-2', Nombre: 'Trabajador Dos', arquetipo: 'supervisor' },
        ],
    });

    assert.equal(evidence.resumen.enviados, 2);
    assert.equal(evidence.resumen.vistos, 1);
    assert.equal(evidence.resumen.aceptados, 1);
    assert.equal(evidence.resumen.pendientes, 1);
    assert.match(buildEvidenceCsv(evidence), /Trabajador Uno/);
});
