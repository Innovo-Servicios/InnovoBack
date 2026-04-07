const mongoose = require('mongoose');
const Token = require('../Controller/token.Controller.js')
const {Permiso} = require('../Model/permiso_Mongoose.js');
const {Rol} = require('../Model/rol_Mongoose.js');
const {trabajador_MongooseModel} = require('../Model/trabajador_Mongoose.js');

const obtenerRoles = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            const roles = await Promise.all(
                x = Rol.find().map(async rol => {
                    const permisos = await Promise.all(
                        rol.permisos.map(async permiso => {
                            return await Permiso.findById(permiso);
                        })
                    );
                    return {
                        nombre: rol.nombre,
                        permisos
                    }
                }
                )
            );
            res.send(roles);
        }catch (error) {
            res.status(500).send('Error interno del servidor: '+ error.message);
        }
    }
}

const crearRol = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {nombre, permisos} = req.body;
        try{
            const nuevoRol = new Rol({
                nombre,
                permisos
            });
            await nuevoRol.save();
            res.send('Rol creado con éxito');
        }catch (error) {
            res.status(500).send('Error interno del servidor: '+ error.message);
        }
    }
}

const rolesTemporales = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {objetivo,horas,rol}=req.body;
        const expires= new Date();
        expires.setHours(expires.getHours()+horas);
        try {
            const trabajador = await trabajador_MongooseModel.findOne({ _id: { $eq: String(objetivo) } });
            trabajador.rolTemporal.rol=rol;
            trabajador.rolTemporal.expiracion=expires;
            await trabajador.save();
            res.status(200).send('Rol temporal asignado con éxito');
        } catch (error) {
            
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else{
        res.status(401).send('Token inválido');
    }
}

const darRol = async (req,res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {objetivo,rol}=req.body;
        try {
            const trabajador = await trabajador_MongooseModel.findOne({ _id: { $eq: String(objetivo) } });
            trabajador.rol=rol;
            await trabajador.save();
            res.status(200).send('Rol asignado con éxito');
        } catch (error) {
            res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else{
        res.status(401).send('Token inválido');
    }
}

const modificarRol = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {id,nombre, permisos} = req.body;
        try{
            await Rol.findByIdAndUpdate(String(id), {nombre, permisos});
            res.send('Rol modificado con éxito');
        }catch (error) {
            res.status(500).send('Error interno del servidor: '+ error.message);
        }
    }
}

module.exports = {obtenerRoles, crearRol, rolesTemporales, modificarRol,darRol};