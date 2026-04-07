const db = require('../Model/server.js');
const mongoose = require('mongoose');
const {sector_MongooseModel:sector} = require('../Model/sector_Mongoose.js')
const {direccion_MongooseModel:direccion} = require('../Model/direccion_Mongoose.js')
const {medidor_MongooseModel:medidor, medidor_MongooseModel} = require('../Model/medidor_Mongoose.js')
const {trabajador_MongooseModel: trabajador_MongooseModel} = require('../Model/trabajador_Mongoose.js')
const {asignacion_MongooseModel:Asignacion} = require('../Model/asignacion_Mongose.js')
const {apoyo_MongooseModel:apoyo} = require('../Model/apoyo.js')
const Token = require('../Controller/token.Controller.js')
const Sector = require('../Controller/sector.Controller.js');
const dayjs = require('dayjs');
const isBetween = require('dayjs/plugin/isBetween');
dayjs.extend(isBetween);

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

const normalizeOptionalString = (value) => {
    if (value === undefined) {
        return { valid: true, provided: false };
    }

    if (typeof value !== 'string') {
        return { valid: false, provided: true };
    }

    const normalizedValue = value.trim();
    if (normalizedValue === '') {
        return { valid: false, provided: true };
    }

    return { valid: true, provided: true, value: normalizedValue };
};

const normalizeOptionalNullableString = (value) => {
    if (value === undefined) {
        return { valid: true, provided: false };
    }

    if (value === null) {
        return { valid: true, provided: true, value: null };
    }

    if (typeof value !== 'string') {
        return { valid: false, provided: true };
    }

    const normalizedValue = value.trim();
    return {
        valid: true,
        provided: true,
        value: normalizedValue === '' ? null : normalizedValue
    };
};

const normalizeOptionalNumber = (value) => {
    if (value === undefined) {
        return { valid: true, provided: false };
    }

    const numericValue = normalizeNumber(value);
    if (numericValue === null) {
        return { valid: false, provided: true };
    }

    return { valid: true, provided: true, value: numericValue };
};

const agregardireccion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){   
        const {NumeroSector ,Numeromedidor,calle, numero, block, depto, comuna, ciudad, region,lat,lng} = req.body;
        try{
            const numeroSector = normalizeNumber(NumeroSector);
            const numeroMedidor = normalizeNumber(Numeromedidor);
            const numeroDireccion = normalizeNumber(numero);
            const latitud = normalizeNumber(lat);
            const longitud = normalizeNumber(lng);
            const calleNormalizada = normalizeRequiredString(calle);
            const comunaNormalizada = normalizeRequiredString(comuna);
            const ciudadNormalizada = normalizeRequiredString(ciudad);
            const regionNormalizada = normalizeRequiredString(region);
            const blockNormalizado = normalizeOptionalNullableString(block);
            const deptoNormalizado = normalizeOptionalNullableString(depto);

            if (
                numeroSector === null ||
                numeroMedidor === null ||
                numeroDireccion === null ||
                latitud === null ||
                longitud === null ||
                !calleNormalizada ||
                !comunaNormalizada ||
                !ciudadNormalizada ||
                !regionNormalizada ||
                !blockNormalizado.valid ||
                !deptoNormalizado.valid
            ) {
                return res.status(400).send('Datos de dirección inválidos');
            }

            const sectorExistente = await sector.findOne(
                mongoose.sanitizeFilter({ NumeroSector: numeroSector })
            );
            const medidorExistente = await medidor.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: numeroMedidor })
            );
            const direccionExistente = await direccion.findOne(
                mongoose.sanitizeFilter({ calle: calleNormalizada, numero: numeroDireccion })
            );
            if (!sectorExistente){
                return res.status(400).send('Sector no existente');
            }
            if (!medidorExistente){
                return res.status(400).send('Medidor no existente');
            }

            const sectorId = normalizeObjectId(sectorExistente._id);
            const medidorId = normalizeObjectId(medidorExistente._id);
            if (!sectorId || !medidorId) {
                return res.status(404).send('Recurso no encontrado');
            }

            if (direccionExistente){
                return res.status(400).send('Direccion existente');
            }

            const nuevadireccion = new direccion({
                _idDireccion: new mongoose.Types.ObjectId(),
                calle: calleNormalizada,
                numero: numeroDireccion,
                block: blockNormalizado.value,
                depto: deptoNormalizado.value,
                comuna: comunaNormalizada,
                ciudad: ciudadNormalizada,
                region: regionNormalizada,
                NumeroMedidor: medidorId,
                NumeroSector: sectorId,
                LAT: latitud,
                LNG: longitud
            });
            await nuevadireccion.save();
            await Sector.calcularPerimetro(sectorId);
            return res.status(201).send('Direccion registrada correctamente');
        }catch (error) {
            // console.error('Error al registrar direccion:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        return res.status(401).send('Token inválido');
    }
};

const modificardireccion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){       
        const {Numeromedidor, Nuevocalle, Nuevonumero, Nuevoblock, Nuevodepto, Nuevonombre, Nuevocomuna, Nuevociudad, Nuevoregion } = req.body;
        try{
            const numeroMedidor = normalizeNumber(Numeromedidor);
            const nuevaCalle = normalizeOptionalString(Nuevocalle);
            const nuevoNumero = normalizeOptionalNumber(Nuevonumero);
            const nuevoBlock = normalizeOptionalNullableString(Nuevoblock);
            const nuevoDepto = normalizeOptionalNullableString(Nuevodepto);
            const nuevoNombre = normalizeOptionalString(Nuevonombre);
            const nuevaComuna = normalizeOptionalString(Nuevocomuna);
            const nuevaCiudad = normalizeOptionalString(Nuevociudad);
            const nuevaRegion = normalizeOptionalString(Nuevoregion);

            if (numeroMedidor === null) {
                return res.status(404).send('Medidor no encontrado.');
            }

            if (
                !nuevaCalle.valid ||
                !nuevoNumero.valid ||
                !nuevoBlock.valid ||
                !nuevoDepto.valid ||
                !nuevoNombre.valid ||
                !nuevaComuna.valid ||
                !nuevaCiudad.valid ||
                !nuevaRegion.valid
            ) {
                return res.status(400).send('Datos de dirección inválidos');
            }

            const direccionmedidor = await medidor.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: numeroMedidor })
            );
            if (!direccionmedidor) {
                return res.status(404).send('Medidor no encontrado.');
            }

            const medidorId = normalizeObjectId(direccionmedidor._id);
            if (!medidorId) {
                return res.status(404).send('Medidor no encontrado.');
            }

            const direccionexistente = await direccion.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: new mongoose.Types.ObjectId(medidorId) })
            );
            if (!direccionexistente) {
                return res.status(404).send('Direccion no encontrado');
            }

            if (nuevaCalle.provided) { direccionexistente.calle = nuevaCalle.value; }
            if (nuevoNumero.provided) { direccionexistente.numero = nuevoNumero.value; }
            direccionexistente.block = nuevoBlock.provided ? nuevoBlock.value : null;
            direccionexistente.depto = nuevoDepto.provided ? nuevoDepto.value : null;
            if (nuevoNombre.provided) { direccionexistente.nombre = nuevoNombre.value; }
            if (nuevaComuna.provided) { direccionexistente.comuna = nuevaComuna.value; }
            if (nuevaCiudad.provided) { direccionexistente.ciudad = nuevaCiudad.value; }
            if (nuevaRegion.provided) { direccionexistente.region = nuevaRegion.value; }

            await direccionexistente.save();
            return res.send('Diereccion modificada correctamente');
        } catch (error) {
            // console.error('Error al modificar direccion:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else {
        return res.status(401).send('Token inválido');
    }
};


const obtenerdireccion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){   
        const {Numeromedidor} = req.body;
        try{
            const numeroMedidor = normalizeNumber(Numeromedidor);
            const rutTrabajador = normalizeRequiredString(tokenValido.token?.rut);
            if (numeroMedidor === null) {
                return res.status(404).send('Medidor no encontrado.');
            }
            if (!rutTrabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const medidorDoc = await medidor_MongooseModel.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: numeroMedidor })
            );
            const trabajador = await trabajador_MongooseModel.findOne(
                mongoose.sanitizeFilter({ Rut: rutTrabajador })
            );
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const trabajadorId = normalizeObjectId(trabajador._id);
            if (!trabajadorId) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const ultimoApoyoId = normalizeObjectId(trabajador.apoyo?.[trabajador.apoyo.length - 1]);
            const lastapoyo = ultimoApoyoId ? await apoyo.findOne(
                mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(ultimoApoyoId) })
            ) : null;

            const hoy = dayjs().startOf('day').subtract(3, 'hours');
            const hoy2 = dayjs().endOf('day').subtract(3, 'hours');
            const asignacion = await Asignacion.find(mongoose.sanitizeFilter({
                Trabajador: new mongoose.Types.ObjectId(trabajadorId),
                fecha_asignacion: {
                    $gte: hoy.toDate(),
                    $lte: hoy2.toDate()
                }
            }));

            const asignacionApoyoId = normalizeObjectId(lastapoyo?.asignacion);
            if (asignacionApoyoId) {
                const asignacionapoyo = await Asignacion.findOne(
                    mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(asignacionApoyoId) })
                );
                if (asignacionapoyo) {
                    asignacion.push(asignacionapoyo);
                }
            }

            if (!asignacion.length) {
                return res.status(404).send('No tienes asignaciones para hoy');
            }
            
            if (!medidorDoc) {
                return res.status(404).send('Medidor no encontrado.');
			}

            const medidorId = normalizeObjectId(medidorDoc._id);
            if (!medidorId) {
                return res.status(404).send('Medidor no encontrado.');
            }
			
			let direccionexistente = null;
			for (let i = 0; i < asignacion.length; i++) {
                const numeroSectorId = normalizeObjectId(asignacion[i]?.NumeroSector);
                if (!numeroSectorId) {
                    continue;
                }

                direccionexistente = await direccion.findOne(mongoose.sanitizeFilter({
					NumeroMedidor: new mongoose.Types.ObjectId(medidorId),
					NumeroSector: new mongoose.Types.ObjectId(numeroSectorId)
				}));
				if (direccionexistente) break;
			}

            if (!direccionexistente) {
                return res.status(404).send('Direccion no encontrada');
            }
        
            return res.send({
                direccion: direccionexistente._id,
                calle: direccionexistente.calle,
            });
        } catch (error) {
                // console.error('Error al obtener direccion cliente:', error);
                return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        return res.status(401).send('Token inválido');
    }
};

const obtenerDireccionesSector = async(req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {NumeroSector} = req.body;
        try {
            const numeroSector = normalizeNumber(NumeroSector);
            if (numeroSector === null) {
                return res.status(404).send('Sector no encontrado');
            }

            const sectorExistente = await sector.findOne(
                mongoose.sanitizeFilter({ NumeroSector: numeroSector })
            );
            if (!sectorExistente){
                return res.status(404).send('Sector no encontrado');
            }

            const sectorId = normalizeObjectId(sectorExistente._id);
            if (!sectorId) {
                return res.status(404).send('Sector no encontrado');
            }

            const direcciones = await direccion.find(
                mongoose.sanitizeFilter({ NumeroSector: new mongoose.Types.ObjectId(sectorId) })
            );
            return res.send(direcciones);
        } catch (error) {
            // console.error('Error al obtener direcciones:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        return res.status(401).send('Token inválido');
    }
}

const modificarCoord= async(req,res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {Numeromedidor, lat, lng} = req.body;
        try{
            const numeroMedidor = normalizeNumber(Numeromedidor);
            const latitud = normalizeNumber(lat);
            const longitud = normalizeNumber(lng);
            if (numeroMedidor === null) {
                return res.status(404).send('Medidor no encontrado.');
            }
            if (latitud === null || longitud === null) {
                return res.status(400).send('Coordenadas inválidas');
            }

            const medidorDoc = await medidor_MongooseModel.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: numeroMedidor })
            );
            if (!medidorDoc){
                return res.status(404).send('Medidor no encontrado.');
            }

            const medidorId = normalizeObjectId(medidorDoc._id);
            if (!medidorId) {
                return res.status(404).send('Medidor no encontrado.');
            }

            const direccionexistente = await direccion.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: new mongoose.Types.ObjectId(medidorId) })
            );
            if (!direccionexistente) {
                return res.status(404).send('Direccion no encontrada');
            }

            direccionexistente.LAT = latitud;
            direccionexistente.LNG = longitud;
            await direccionexistente.save();
            return res.send('Coordenadas actualizadas correctamente');
        } catch (error) {
            // console.error('Error al modificar coordenadas:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        return res.status(401).send('Token inválido');
    }
}

const comentarDireccion = async (req, res) => {
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {Numeromedidor, comentario} = req.body;
        try{
            const numeroMedidor = normalizeNumber(Numeromedidor);
            const comentarioNormalizado = normalizeRequiredString(comentario);
            if (numeroMedidor === null) {
                return res.status(404).send('Medidor no encontrado.');
            }
            if (!comentarioNormalizado) {
                return res.status(400).send('Comentario inválido');
            }

            const medidorDoc = await medidor_MongooseModel.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: numeroMedidor })
            );
            if (!medidorDoc){
                return res.status(404).send('Medidor no encontrado.');
            }

            const medidorId = normalizeObjectId(medidorDoc._id);
            if (!medidorId) {
                return res.status(404).send('Medidor no encontrado.');
            }

            const direccionexistente = await direccion.findOne(
                mongoose.sanitizeFilter({ NumeroMedidor: new mongoose.Types.ObjectId(medidorId) })
            );
            if (!direccionexistente) {
                return res.status(404).send('Direccion no encontrada');
            }

            direccionexistente.comentario = comentarioNormalizado;
            await direccionexistente.save();
            return res.send('Comentario agregado correctamente');
        } catch (error) {
            // console.error('Error al agregar comentario:', error);
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    } else {
        return res.status(401).send('Token inválido');
    }
}

const listadirecciones=async(req,res)=>{
    const { token } = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            const rutTrabajador = normalizeRequiredString(tokenValido.token?.rut);
            if (!rutTrabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const trabajador = await trabajador_MongooseModel.findOne(
                mongoose.sanitizeFilter({ Rut: rutTrabajador })
            );
            if (!trabajador) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const trabajadorId = normalizeObjectId(trabajador._id);
            if (!trabajadorId) {
                return res.status(404).send('Trabajador no encontrado');
            }

            const ultimoApoyoId = normalizeObjectId(trabajador.apoyo?.[trabajador.apoyo.length - 1]);
            const lastapoyo = ultimoApoyoId ? await apoyo.findOne(
                mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(ultimoApoyoId) })
            ) : null;
            const asignacion = await Asignacion.findOne(mongoose.sanitizeFilter({
                Trabajador: new mongoose.Types.ObjectId(trabajadorId),
                fecha_asignacion: {
                    $gte: dayjs().startOf('day').subtract(3,'hours').toDate(),
                    $lte: dayjs().endOf('day').subtract(3,'hours').toDate()
                }
            }));
            if (!asignacion){
                return res.status(204).send('No tienes asignaciones para hoy');
            }

            const numeroSectorAsignacionId = normalizeObjectId(asignacion.NumeroSector);
            if (!numeroSectorAsignacionId) {
                return res.status(404).send('No tienes asignaciones para hoy');
            }

            const direcciones = await direccion.find(
                mongoose.sanitizeFilter({ NumeroSector: new mongoose.Types.ObjectId(numeroSectorAsignacionId) }),
                { _id: 0, calle: 1 }
            ).populate('NumeroMedidor','NumeroMedidor');
            
            
            if (lastapoyo && dayjs().isBetween(dayjs(lastapoyo.fecha_inicio), dayjs(lastapoyo.fecha_fin), null, '[]')) {
                const asignacionApoyoId = normalizeObjectId(lastapoyo.asignacion);
                const ASIGNesapoyo = asignacionApoyoId ? await Asignacion.findOne(
                    mongoose.sanitizeFilter({ _id: new mongoose.Types.ObjectId(asignacionApoyoId) })
                ) : null;
                if (ASIGNesapoyo) {
                    const numeroSectorApoyoId = normalizeObjectId(ASIGNesapoyo.NumeroSector);
                    if (numeroSectorApoyoId) {
                        const direccionapoyo = await direccion.find(
                            mongoose.sanitizeFilter({ NumeroSector: new mongoose.Types.ObjectId(numeroSectorApoyoId) }),
                            { _id: 0, calle: 1 }
                        ).populate('NumeroMedidor', 'NumeroMedidor -_id');
                        direcciones.push(direccionapoyo);
                    }
                }
            }
            const direcciones2 = direcciones.map((direccion) => {
                return {"calle":direccion.calle, "_id":direccion.NumeroMedidor._id,"NumeroMedidor":direccion.NumeroMedidor.NumeroMedidor};
                
            });
            return res.send(direcciones2);

        }catch (error){
            return res.status(500).send('Error interno del servidor: ' + error.message);
        }
    }else{
        return res.status(401).send('Token inválido');
    }
}

// AGREGRAR DELETE DIRECCION

module.exports = {agregardireccion, modificardireccion, obtenerdireccion,obtenerDireccionesSector,modificarCoord,comentarDireccion ,listadirecciones};
