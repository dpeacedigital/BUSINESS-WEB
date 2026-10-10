const express = require('express');
const methodOverride = require('method-override');
const path = require('path');
require('dotenv').config();

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Dashboard route: view all products, total inventory value, low-stock warnings
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

    // Calculate metrics
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
    console.error(err);
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

// Record a sale (reduces stock)
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