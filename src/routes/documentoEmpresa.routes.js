const router = require('express').Router();
const { uploadCompanyDocument } = require('../middlewares/multerConfig.js');
const { uploadLimiter } = require('../middlewares/rateLimit.middleware.js');
const { requirePermission } = require('../middlewares/auth.middleware.js');
const controller = require('../controllers/documentoEmpresa.controller.js');

const companyDocumentUpload = (req, res, next) => {
    uploadCompanyDocument.single('file')(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'El archivo supera el límite de 25 MB' });
        }
        return res.status(400).json({ message: error.message || 'Archivo empresarial inválido' });
    });
};

router.get('/categorias', requirePermission('documentos_empresa.ver'), controller.listCategories);
router.post('/categorias', requirePermission('documentos_empresa.categorias.gestionar'), controller.createCategory);
router.put('/categorias/:id', requirePermission('documentos_empresa.categorias.gestionar'), controller.updateCategory);
router.delete('/categorias/:id', requirePermission('documentos_empresa.categorias.gestionar'), controller.archiveCategory);

router.get('/resumen', requirePermission('documentos_empresa.ver'), controller.getSummary);
router.get('/firmantes/candidatos', requirePermission('documentos_empresa.firmas.gestionar'), controller.getCandidates);
router.get('/disponibles', controller.listAvailableDocuments);
router.get('/control-cambios', requirePermission('documentos_empresa.ver'), controller.listChangeControl);
router.get('/archivo/:id/:fileName', controller.downloadDocument);

router.get('/', requirePermission('documentos_empresa.ver'), controller.listDocuments);
router.post('/', requirePermission('documentos_empresa.gestionar'), uploadLimiter, companyDocumentUpload, controller.createDocument);
router.get('/:id', requirePermission('documentos_empresa.ver'), controller.getDocument);
router.put('/:id', requirePermission('documentos_empresa.gestionar'), controller.updateDocument);
router.delete('/:id', requirePermission('documentos_empresa.gestionar'), controller.archiveDocument);
router.post('/:id/renovar', requirePermission('documentos_empresa.gestionar'), uploadLimiter, companyDocumentUpload, controller.renewDocument);
router.post('/:id/aprobaciones', requirePermission('documentos_empresa.gestionar'), controller.approveDocument);
router.post('/:id/difundir', requirePermission('documentos_empresa.firmas.gestionar'), controller.diffuseDocument);
router.get('/:id/evidencia', requirePermission('documentos_empresa.ver'), controller.getDocumentEvidence);
router.post('/:id/firmantes', requirePermission('documentos_empresa.firmas.gestionar'), controller.addPhysicalSigner);
router.put('/:id/firmantes/:firmanteId', requirePermission('documentos_empresa.firmas.gestionar'), controller.updatePhysicalSigner);
router.delete('/:id/firmantes/:firmanteId', requirePermission('documentos_empresa.firmas.gestionar'), controller.removePhysicalSigner);

module.exports = router;
