const express = require('express');
const { asyncRoute } = require('../middleware/error-handler');
const { toProduct } = require('../dto');

function catalogRoutes({ catalogService }) {
  const router = express.Router();

  router.get('/products', asyncRoute(async (req, res) => {
    const products = await catalogService.listProducts();
    res.json(products.map(toProduct));
  }));

  return router;
}

module.exports = { catalogRoutes };
