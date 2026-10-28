const express = require('express');
const { getPool } = require('../db');

const router = express.Router();

/**
 * @openapi
 * /api/customers:
 *   get:
 *     summary: Get all customers
 *     description: Returns id, first_name as name, and country from dbo.customers.
 *     responses:
 *       200:
 *         description: Customers retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     oneOf:
 *                       - type: integer
 *                       - type: string
 *                   name:
 *                     type: string
 *                     nullable: true
 *                   country:
 *                     type: string
 *                     nullable: true
 *       500:
 *         description: The customers could not be retrieved.
 */
router.get('/customers', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT id, first_name AS name, country FROM dbo.customers');

    res.json(result.recordset);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
