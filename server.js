const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: "postgresql://postgres.zgnpjwczcnbbhpwrdbbg:HHHH@mid1376@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

// GET همه مخاطبین
app.get("/contacts", async (req, res) => {
  const result = await pool.query("SELECT * FROM contacts ORDER BY id DESC");
  res.json(result.rows);
});

// GET یک مخاطب
app.get("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT * FROM contacts WHERE id = $1", [id]);
  res.json(result.rows[0]);
});

// POST اضافه کردن
app.post("/contacts", async (req, res) => {
  const { name, phone, category, date } = req.body;
  const result = await pool.query(
    "INSERT INTO contacts (name, phone, category, date) VALUES ($1, $2, $3, $4) RETURNING *",
    [name, phone, category || "Other", date || ""]
  );
  res.json(result.rows[0]);
});

// PUT ویرایش
app.put("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const { name, phone, category, date } = req.body;
  const result = await pool.query(
    "UPDATE contacts SET name = $1, phone = $2, category = $3, date = $4 WHERE id = $5 RETURNING *",
    [name, phone, category || "Other", date || "", id]
  );
  res.json(result.rows[0]);
});

// DELETE حذف
app.delete("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM contacts WHERE id = $1", [id]);
  res.json({ message: "Contact deleted" });
});

app.listen(3001, () => {
  console.log("Server is running on port 3001");
});