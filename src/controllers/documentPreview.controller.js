const {
    buildRequestBaseUrl,
    createDocumentPreviewService,
} = require('../services/documentPreview.service.js');

const previewService = createDocumentPreviewService();

const getStatusFromError = (error) =>
    Number.isInteger(error?.status) ? error.status : 500;

const getMessageFromError = (error, fallback = 'Error interno del servidor') =>
    error instanceof Error && error.message ? error.message : fallback;

const createPreviewTicket = async (req, res) => {
    try {
        const result = await previewService.issuePreviewTicket({
            source: req.body?.source,
            id: req.body?.id,
            context: {
                auth: req.auth,
                authUser: req.authUser,
                authz: req.authz,
                user: req.authUser,
            },
            baseUrl: buildRequestBaseUrl(req),
        });

        return res.json({
            url: result.url,
            expiresAt: result.expiresAt,
        });
    } catch (error) {
        const status = getStatusFromError(error);
        if (status >= 500) {
            console.error('Error al crear vista previa de documento:', getMessageFromError(error));
        }
        return res.status(status).json({ message: getMessageFromError(error) });
    }
};

const openPreviewTicket = async (req, res) => {
    try {
        const descriptor = await previewService.resolvePreviewTicket({
            ticket: req.params.ticket,
        });

        return res.sendFile(descriptor.filePath, {
            headers: {
                'Cache-Control': 'no-store',
                'Content-Disposition': `inline; filename="${descriptor.fileName}"`,
                'Content-Type': 'application/pdf',
                Pragma: 'no-cache',
            },
        });
    } catch (error) {
        const status = getStatusFromError(error);
        if (status >= 500) {
            console.error('Error al abrir vista previa de documento:', getMessageFromError(error));
        }
        return res.status(status).send(getMessageFromError(error));
    }
};

module.exports = {
    createPreviewTicket,
    openPreviewTicket,
};
