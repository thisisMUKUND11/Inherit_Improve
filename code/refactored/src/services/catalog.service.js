/*
 * Catalogue reads.
 *
 * Small, but it exists for a reason: the legacy endpoint was
 * `SELECT * FROM products`, so adding a column to the table changed the public
 * API, and cost_price and supplier were published to every visitor. Here the
 * service returns a defined shape and the mapping in http/dto.js decides what
 * a customer is allowed to see.
 */

function createCatalogService({ productRepo }) {
  return {
    async listProducts() {
      const rows = await productRepo.listAll();
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        priceMinor: row.price_minor,
        stock: row.stock,
        // cost_minor and supplier are deliberately not carried out of this
        // function. Commercially sensitive data does not leave the service
        // layer by accident; it has to be asked for.
      }));
    },
  };
}

module.exports = { createCatalogService };
