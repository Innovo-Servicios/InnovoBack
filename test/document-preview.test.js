const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-document-preview-secret';

const {
    createDocumentPreviewService,
} = require('../src/services/documentPreview.service.js');

const makeService = ({
    document,
    user,
    worker,
    workerDocumentsRoot = '/tmp/trabajadores',
    fsExists = true,
} = {}) => createDocumentPreviewService({
    documentModel: {
        findById: async (id) => String(id) === String(document?._id) ? document : null,
    },
    workerModel: {
        findById: async (id) => String(id) === String(user?._id) ? user : null,
        findOne: async () => worker || null,
    },
    companyDocumentModel: {
        findById: async () => null,
    },
    notificationModel: {
        findById: async () => null,
    },
    fsModule: {
        existsSync: () => fsExists,
    },
    getAccessContext: async (resolvedUser) => ({
        arquetipo: resolvedUser?.cargo || 'lector',
        permisos: [],
    }),
    workerDocumentsRoot,
});

test('document preview ticket opens an own worker PDF after revalidating the ticket', async () => {
    const documentId = new mongoose.Types.ObjectId().toString();
    const workerId = new mongoose.Types.ObjectId().toString();
    const user = {
        _id: workerId,
        Rut: '11111111-1',
        cargo: 'lector',
        sessionVersion: 0,
    };
    const service = makeService({
        user,
        worker: user,
        document: {
            _id: documentId,
            url: '/tmp/trabajadores/contrato.pdf',
            nombreOriginal: 'Contrato.pdf',
            formato: 'application/pdf',
        },
    });

    const ticket = await service.issuePreviewTicket({
        source: 'worker',
        id: documentId,
        context: { user, authUser: user, authz: { arquetipo: 'lector', permisos: [] } },
        baseUrl: 'https://api.example.test',
    });
    const descriptor = await service.resolvePreviewTicket({ ticket: ticket.token });

    assert.match(ticket.url, /^https:\/\/api\.example\.test\/document-preview\//);
    assert.equal(descriptor.filePath, '/tmp/trabajadores/contrato.pdf');
    assert.equal(descriptor.mimeType, 'application/pdf');
    assert.equal(descriptor.fileName, 'Contrato.pdf');
});

test('document preview rejects another worker document for a lector', async () => {
    const documentId = new mongoose.Types.ObjectId().toString();
    const user = {
        _id: new mongoose.Types.ObjectId().toString(),
        Rut: '22222222-2',
        cargo: 'lector',
        sessionVersion: 0,
    };
    const service = makeService({
        user,
        worker: {
            _id: new mongoose.Types.ObjectId().toString(),
            Rut: '11111111-1',
        },
        document: {
            _id: documentId,
            url: '/tmp/trabajadores/contrato.pdf',
            nombreOriginal: 'Contrato.pdf',
            formato: 'application/pdf',
        },
    });

    await assert.rejects(
        () => service.issuePreviewTicket({
            source: 'worker',
            id: documentId,
            context: { user, authUser: user, authz: { arquetipo: 'lector', permisos: [] } },
            baseUrl: 'https://api.example.test',
        }),
        (error) => {
            assert.equal(error.status, 403);
            return true;
        }
    );
});

test('document preview rejects non-PDF worker documents', async () => {
    const documentId = new mongoose.Types.ObjectId().toString();
    const user = {
        _id: new mongoose.Types.ObjectId().toString(),
        Rut: '11111111-1',
        cargo: 'lector',
        sessionVersion: 0,
    };
    const service = makeService({
        user,
        worker: user,
        document: {
            _id: documentId,
            url: '/tmp/trabajadores/imagen.jpeg',
            nombreOriginal: 'Foto.jpeg',
            formato: 'image/jpeg',
        },
    });

    await assert.rejects(
        () => service.issuePreviewTicket({
            source: 'worker',
            id: documentId,
            context: { user, authUser: user, authz: { arquetipo: 'lector', permisos: [] } },
            baseUrl: 'https://api.example.test',
        }),
        (error) => {
            assert.equal(error.status, 415);
            return true;
        }
    );
});

test('document preview rejects expired and malformed tickets', async () => {
    const documentId = new mongoose.Types.ObjectId().toString();
    const user = {
        _id: new mongoose.Types.ObjectId().toString(),
        Rut: '11111111-1',
        cargo: 'lector',
        sessionVersion: 0,
    };
    const service = makeService({ user });
    const expiredTicket = jwt.sign({
        type: 'document-preview',
        source: 'worker',
        id: documentId,
        sub: String(user._id),
        rut: user.Rut,
        sessionVersion: 0,
    }, process.env.JWT_SECRET, { expiresIn: -1 });

    await assert.rejects(
        () => service.resolvePreviewTicket({ ticket: expiredTicket }),
        (error) => {
            assert.equal(error.status, 401);
            assert.match(error.message, /expirada/i);
            return true;
        }
    );

    await assert.rejects(
        () => service.resolvePreviewTicket({ ticket: 'ticket-invalido' }),
        (error) => {
            assert.equal(error.status, 401);
            assert.match(error.message, /inválida/i);
            return true;
        }
    );
});
