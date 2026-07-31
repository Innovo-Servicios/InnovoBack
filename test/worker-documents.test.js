const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    crearDocumentoMasivo,
    __testables,
} = require('../src/controllers/documento.controller.js');
const { sanitizeDocumentForClient } = require('../src/utils/security.js');

const {
    createDocumentForWorker,
    createMassWorkerDocuments,
    getMassWorkerDocumentsStatus,
} = __testables;

const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    },
});

const makeFile = () => ({
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('documento'),
});

test('mass personal document upload rejects missing files before touching data', async () => {
    const response = makeResponse();

    await crearDocumentoMasivo({ body: { tipo: new mongoose.Types.ObjectId().toString() } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, 'No se ha subido ningún archivo');
});

test('mass personal document upload rejects invalid document types before touching data', async () => {
    const response = makeResponse();

    await crearDocumentoMasivo({ body: { tipo: 'tipo-invalido' }, file: makeFile() }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, 'Tipo de documento inválido');
});

test('worker personal document creation writes one document reference for a worker', async () => {
    const documentId = new mongoose.Types.ObjectId();
    const tipoId = new mongoose.Types.ObjectId();
    const worker = {
        _id: new mongoose.Types.ObjectId(),
        Rut: '11111111-1',
        Nombre: 'Trabajador Uno',
        documentos: [],
        saveCalls: 0,
        async save() {
            this.saveCalls += 1;
        },
    };
    const savedDocuments = [];
    const createdDirectories = [];
    const writtenFiles = [];

    await createDocumentForWorker({
        worker,
        tipoId,
        file: makeFile(),
        objectIdFactory: () => documentId,
        fsModule: {
            existsSync: () => false,
            mkdirSync: (dir) => createdDirectories.push(dir),
            unlinkSync: () => undefined,
        },
        writeFile: async ({ finalPath }) => {
            writtenFiles.push(finalPath);
        },
        documentFactory: (payload) => ({
            ...payload,
            async save() {
                savedDocuments.push(payload);
            },
            async deleteOne() {},
        }),
        now: () => new Date('2026-06-23T12:00:00.000Z'),
    });

    assert.equal(worker.saveCalls, 1);
    assert.equal(worker.documentos.length, 1);
    assert.equal(String(worker.documentos[0]), String(documentId));
    assert.equal(savedDocuments.length, 1);
    assert.equal(savedDocuments[0].nombreOriginal, 'contrato.pdf');
    assert.equal(String(savedDocuments[0].tipo), String(tipoId));
    assert.equal(savedDocuments[0].formato, 'application/pdf');
    assert.equal(createdDirectories.length, 1);
    assert.equal(writtenFiles.length, 1);
});

test('worker document client payload prefers the stored original file name', () => {
    const id = new mongoose.Types.ObjectId();

    const documentWithOriginalName = sanitizeDocumentForClient({
        _id: id,
        tipo: new mongoose.Types.ObjectId(),
        nombreOriginal: 'Certificado curso.pdf',
        url: `/tmp/TRABAJADORES/${id}/file-123-${id}-otro.pdf`,
        formato: 'application/pdf',
        fecha: new Date('2026-06-23T12:00:00.000Z'),
    });
    const legacyDocument = sanitizeDocumentForClient({
        _id: id,
        tipo: new mongoose.Types.ObjectId(),
        url: `/tmp/TRABAJADORES/${id}/file-123-${id}-Reglamento.pdf`,
        formato: 'application/pdf',
        fecha: new Date('2026-06-23T12:00:00.000Z'),
    });

    assert.equal(documentWithOriginalName.nombreOriginal, 'Certificado curso.pdf');
    assert.equal(legacyDocument.nombreOriginal, 'Reglamento.pdf');
});

test('mass personal document fanout reports every current worker on success', async () => {
    const tipoId = new mongoose.Types.ObjectId();
    const workers = [
        { _id: new mongoose.Types.ObjectId(), Rut: '11111111-1', Nombre: 'Uno' },
        { _id: new mongoose.Types.ObjectId(), Rut: '22222222-2', Nombre: 'Dos' },
    ];
    const touchedWorkers = [];

    const result = await createMassWorkerDocuments({
        workers,
        tipoId,
        file: makeFile(),
        createOne: async ({ worker }) => {
            touchedWorkers.push(worker.Rut);
        },
    });

    assert.deepEqual(touchedWorkers, ['11111111-1', '22222222-2']);
    assert.equal(result.totalTrabajadores, 2);
    assert.equal(result.documentosCreados, 2);
    assert.deepEqual(result.fallidos, []);
    assert.equal(getMassWorkerDocumentsStatus(result), 201);
});

test('mass personal document fanout returns partial failures without stopping the batch', async () => {
    const workers = [
        { _id: new mongoose.Types.ObjectId(), Rut: '11111111-1', Nombre: 'Uno' },
        { _id: new mongoose.Types.ObjectId(), Rut: '22222222-2', Nombre: 'Dos' },
        { _id: new mongoose.Types.ObjectId(), Rut: '33333333-3', Nombre: 'Tres' },
    ];

    const result = await createMassWorkerDocuments({
        workers,
        tipoId: new mongoose.Types.ObjectId(),
        file: makeFile(),
        createOne: async ({ worker }) => {
            if (worker.Rut === '22222222-2') {
                throw new Error('Fallo controlado');
            }
        },
    });

    assert.equal(result.totalTrabajadores, 3);
    assert.equal(result.documentosCreados, 2);
    assert.equal(result.fallidos.length, 1);
    assert.equal(result.fallidos[0].rut, '22222222-2');
    assert.equal(result.fallidos[0].nombre, 'Dos');
    assert.equal(result.fallidos[0].motivo, 'Fallo controlado');
    assert.equal(getMassWorkerDocumentsStatus(result), 207);
});
