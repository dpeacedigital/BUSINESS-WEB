const express = require('express');
const methodOverride = require('method-override');
const path = require('path');
require('dotenv').config();

// 1. Initialize pool first
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// 2. Automatically verify or create tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) UNIQUE,
        category VARCHAR(100),
        cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity_sold INTEGER NOT NULL,
        selling_price NUMERIC(10, 2) NOT NULL,
        total_amount NUMERIC(10, 2) NOT NULL,
        sold_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables verified / created successfully!');
  } catch (err) {
    console.error('Database connection / setup notice:', err.message);
  }
}
initDB();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Dashboard route
app.get('/', async (req, res) => {
  try {
    const searchQuery = req.query.search || '';
    let productQuery = 'SELECT * FROM products ORDER BY id DESC';
    let params = [];

    if (searchQuery) {
      productQuery = 'SELECT * FROM products WHERE name ILIKE $1 OR category ILIKE $1 ORDER BY id DESC';
      params = [`%${searchQuery}%`];
    }

    const { rows: products } = await pool.query(productQuery, params);

    const totalProducts = products.length;
    const totalInventoryValue = products.reduce((acc, p) => acc + (parseFloat(p.selling_price) * parseInt(p.stock_quantity)), 0);
    const lowStockItems = products.filter(p => p.stock_quantity <= p.low_stock_threshold);

    res.render('index', {
      products,
      searchQuery,
      totalProducts,
      totalInventoryValue: totalInventoryValue.toFixed(2),
      lowStockCount: lowStockItems.length
    });
  } catch (err) {
    console.error('Route error:', err);
    res.status(500).send('Database Error');
  }
});

// Add new product
app.post('/products', async (req, res) => {
  const { name, sku, category, cost_price, selling_price, stock_quantity, low_stock_threshold } = req.body;
  try {
    await pool.query(
      `INSERT INTO products (name, sku, category, cost_price, selling_price, stock_quantity, low_stock_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, sku, category, cost_price || 0, selling_price || 0, stock_quantity || 0, low_stock_threshold || 5]
    );
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving product');
  }
});

// Record a sale
app.post('/sales', async (req, res) => {
  const { product_id, quantity_sold } = req.body;
  const qty = parseInt(quantity_sold);

  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (!rows.length) return res.status(404).send('Product not found');

    const product = rows[0];
    if (product.stock_quantity < qty) {
      return res.status(400).send('Not enough stock available');
    }

    const totalAmount = parseFloat(product.selling_price) * qty;

    await pool.query(
      'INSERT INTO sales (product_id, quantity_sold, selling_price, total_amount) VALUES ($1, $2, $3, $4)',
      [product_id, qty, product.selling_price, totalAmount]
    );

    await pool.query(
      'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
      [qty, product_id]
    );

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing sale');
  }
});

// Delete product
app.delete('/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting product');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});