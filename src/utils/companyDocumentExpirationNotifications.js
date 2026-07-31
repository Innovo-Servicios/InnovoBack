const moment = require('moment-timezone');
const { DocumentoEmpresa } = require('../models/documentoEmpresa.model.js');
const { trabajador_MongooseModel: Trabajador } = require('../models/trabajador.model.js');
const { createSystemNotificationForWorkers } = require('../controllers/notificaciones.controller.js');
const { getUserAccessContext } = require('../services/accessControl.service.js');
const { getExpirationMilestone } = require('../services/companyDocuments.service.js');

const TIMEZONE = 'America/Santiago';

const getDocumentManagers = async () => {
    const workers = await Trabajador.find().select(
        '_id Rut Nombre cargo arquetipo rol rolTemporal notificaciones documentos tokenPush'
    );
    const contexts = await Promise.all(workers.map((worker) => getUserAccessContext(worker)));
    return workers.filter((worker, index) =>
        contexts[index].permisos.includes('documentos_empresa.gestionar')
    );
};

const milestoneMessage = (document, remaining) => {
    const expiration = moment(document.fechaVencimiento).tz(TIMEZONE).format('DD-MM-YYYY');
    if (remaining < 0) {
        return `El documento "${document.titulo}" venció el ${expiration}. Debe renovarse.`;
    }
    if (remaining === 0) {
        return `El documento "${document.titulo}" vence hoy (${expiration}).`;
    }
    return `El documento "${document.titulo}" vence en ${remaining} día${remaining === 1 ? '' : 's'} (${expiration}).`;
};

const dispatchCompanyDocumentExpirationNotifications = async ({ io, now = new Date() } = {}) => {
    const documents = await DocumentoEmpresa.find({
        estado: 'vigente',
        fechaVencimiento: { $exists: true, $ne: null },
    }).populate('categoria');
    const pending = documents.map((document) => {
        const expirationSnapshot = document.vencimientoAvisado
            ? new Date(document.vencimientoAvisado).getTime()
            : null;
        const currentExpiration = new Date(document.fechaVencimiento).getTime();
        if (expirationSnapshot && expirationSnapshot !== currentExpiration) {
            document.ultimoHitoAvisado = 0;
            document.vencimientoAvisado = undefined;
        }
        return { document, ...getExpirationMilestone(document, now) };
    }).filter(({ level, document }) => level > (document.ultimoHitoAvisado || 0));

    if (pending.length === 0) return { sent: 0, pending: 0 };
    const managers = await getDocumentManagers();
    if (managers.length === 0) return { sent: 0, pending: pending.length };

    let sent = 0;
    for (const { document, level, remaining } of pending) {
        const message = milestoneMessage(document, remaining);
        await createSystemNotificationForWorkers({
            trabajadores: managers,
            tipo: 'alert',
            titulo: remaining < 0 ? 'Documento empresarial vencido' : 'Documento próximo a vencer',
            mensaje: message,
            contenido: `${document.categoria?.nombre || 'Documentos'} · versión ${document.version}`,
            // Los avisos no adjuntan el archivo: la URL de notificaciones se
            // reserva para descargas autenticadas. El frontend abre la ficha
            // mediante el identificador incluido en metadata.
            url: null,
            metadata: {
                tipo: 'documento_empresa_vencimiento',
                documentoEmpresaId: String(document._id),
                hito: level,
                diasRestantes: remaining,
            },
            io,
        });
        document.ultimoHitoAvisado = level;
        document.vencimientoAvisado = document.fechaVencimiento;
        await document.save();
        io?.to('permission:documentos_empresa.ver').emit('documentosEmpresaActualizados', {
            id: String(document._id),
        });
        sent += 1;
    }
    return { sent, pending: pending.length };
};

module.exports = {
    dispatchCompanyDocumentExpirationNotifications,
    getDocumentManagers,
    milestoneMessage,
};
