const mongoose = require('mongoose');
const { cliente_MongooseModel: cliente } = require('../Model/cliente_Mongoose');
const { medidor_MongooseModel: medidor } = require('../Model/medidor_Mongoose');
const { direccion_MongooseModel: direccion } = require('../Model/direccion_Mongoose');
const Token = require('../Controller/token.Controller.js')

const normalizeRequiredString = (value) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue === '' ? null : normalizedValue;
};

const normalizeNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.trim();
    if (normalizedValue === '') {
        return null;
    }

    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeObjectId = (value) => {
    if (!(typeof value === 'string' || value instanceof mongoose.Types.ObjectId)) {
        return null;
    }

    const normalizedValue = String(value).trim();
    if (normalizedValue === '' || !mongoose.isValidObjectId(normalizedValue)) {
        return null;
    }

    return normalizedValue;
};

const crearcliente = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){ 
        const { NumeroCliente, nombre } = req.body;
        try {
            const numeroCliente = normalizeNumber(NumeroCliente);
            const nombreCliente = normalizeRequiredString(nombre);
            if (numeroCliente === null || !nombreCliente) {
                return res.status(400).send('Datos de cliente inválidos');
            }

            const usuarioExistente = await cliente.findOne(
                mongoose.sanitizeFilter({ NumeroCliente: numeroCliente })
            );
            if (usuarioExistente) {
                return res.status(400).send('El usuario ya existe');
            }
            const nuevocliente = new cliente({
                _id: new mongoose.Types.ObjectId(),
                nombre: nombreCliente,
                NumeroCliente: numeroCliente
            });
            await nuevocliente.save();
            return res.status(201).send('Cliente registrado correctamente');
        } catch (error) {
            console.error('Error al registrar cliente:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        return res.status(401).send('Token inválido');
    }
};

const obtenercliente = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){    
        const { NumeroCliente } = req.body;
        try {
            const numeroCliente = normalizeNumber(NumeroCliente);
            if (numeroCliente === null) {
                return res.status(404).send('Cliente no encontrado');
            }

            const clienteEncontrado = await cliente.findOne(
                mongoose.sanitizeFilter({ NumeroCliente: numeroCliente })
            );
            if (clienteEncontrado) {
                return res.status(200).json({ message: 'Cliente encontrado', cliente: clienteEncontrado });
            } else {
                res.status(404).send('Cliente no encontrado');
            }
        } catch (error) {
            console.error('Error al obtener cliente:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        return res.status(401).send('Token inválido');
    }
};

const eliminarCliente = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){   
        const { NumeroCliente } = req.body;

        try {
            const numeroCliente = normalizeNumber(NumeroCliente);
            if (numeroCliente === null) {
                return res.status(404).send('Cliente no existente');
            }

            const clienteExistente = await cliente.findOne(
                mongoose.sanitizeFilter({ NumeroCliente: numeroCliente })
            );
            if (!clienteExistente) {
                return res.status(404).send('Cliente no existente');
            }

            const clienteId = normalizeObjectId(clienteExistente._id);
            if (!clienteId) {
                return res.status(404).send('Cliente no existente');
            }

            // Eliminar direcciones asociadas
            const direccionesEliminadas = await direccion.deleteMany(
                mongoose.sanitizeFilter({ NumeroCliente: new mongoose.Types.ObjectId(clienteId) })
            );
            // console.log(`${direccionesEliminadas.deletedCount} direcciones eliminadas.`);

            // Eliminar medidores asociados
            const medidoresEliminados = await medidor.deleteMany(
                mongoose.sanitizeFilter({ NumeroCliente: new mongoose.Types.ObjectId(clienteId) })
            );
            // console.log(`${medidoresEliminados.deletedCount} medidores eliminados.`);

            // Finalmente eliminar el cliente
            await cliente.deleteOne(
                mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(clienteId) })
            );

            return res.status(200).send('Cliente y todos los registros asociados eliminados correctamente');
        } catch (error) {
            console.error('Error al eliminar el cliente y registros asociados:', error);
            return res.status(500).send('Error interno del servidor');
        }
    }else {
        return res.status(401).send('Token inválido');
    }
};

module.exports = { crearcliente, eliminarCliente, obtenercliente };
