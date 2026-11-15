// Lista sklepów testowych dla serwera: STORES_MODULE=test/fake-stores.js (sklep testowy: node test/fakeshop.js)
module.exports = require('./fakeshop').storesFor(`http://localhost:${process.env.SHOP_PORT || 4100}`);
