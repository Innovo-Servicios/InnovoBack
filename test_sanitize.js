const mongoSanitize = require('express-mongo-sanitize');
let obj = { $test: 123, normal: 1 };
const res = mongoSanitize.sanitize(obj);
console.log(obj, res, obj === res);
