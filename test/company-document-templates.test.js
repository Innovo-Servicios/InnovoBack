const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildTemplatePreviewHtml,
    extractTemplateVariables,
    htmlToPlainText,
    sanitizeTemplateHtml,
} = require('../src/services/companyDocumentSignedPdf.service.js');

test('document template HTML is sanitized while keeping tables and variables', () => {
    const html = sanitizeTemplateHtml(`
        <h1 onclick="alert(1)">Entrega {{trabajador.nombre}}</h1>
        <script>alert("xss")</script>
        <table onclick="alert(2)"><tr><th>Campo</th><td>{{documento.version}}</td></tr></table>
    `);

    assert.match(html, /<h1>Entrega {{trabajador.nombre}}<\/h1>/);
    assert.match(html, /<table>/);
    assert.match(html, /{{documento.version}}/);
    assert.doesNotMatch(html, /script/);
    assert.doesNotMatch(html, /onclick/);
});

test('document template variables are detected and rendered in preview HTML', () => {
    const template = {
        nombre: 'Entrega de EPP',
        codigoBase: 'SGI-EPP',
        contenidoHtml: `
            <h1>Entrega a {{trabajador.nombre}}</h1>
            <p>RUT {{trabajador.rut}}</p>
            <table><tbody><tr><td>Version</td><td>{{documento.version}}</td></tr></tbody></table>
            <p>Codigo {{firma.codigo}}</p>
        `,
        textoAceptacion: 'Acepto {{documento.titulo}}',
    };

    assert.deepEqual(extractTemplateVariables(template.contenidoHtml, template.textoAceptacion), [
        'documento.titulo',
        'documento.version',
        'firma.codigo',
        'trabajador.nombre',
        'trabajador.rut',
    ]);

    const preview = buildTemplatePreviewHtml({
        template,
        documentData: {
            titulo: 'Entrega EPP casco',
            version: 3,
            trabajadorNombre: 'Ana Perez',
            trabajadorRut: '12.345.678-9',
        },
    });

    assert.match(preview, /Entrega a Ana Perez/);
    assert.match(preview, /RUT 12.345.678-9/);
    assert.match(preview, /<td>3<\/td>/);
    assert.match(preview, /Codigo Pendiente de firma/);
    assert.equal(htmlToPlainText(template.contenidoHtml).includes('Version'), true);
});
