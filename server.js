const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: "postgresql://postgres.zgnpjwczcnbbhpwrdbbg:HHHH@mid1376@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
  max: 1
});

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  'https://zgnpjwczcnbbhpwrdbbg.supabase.co',
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ── گرفتن پروفایل کاربر ──
app.get("/profile/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const result = await pool.query(
    "SELECT * FROM profiles WHERE id = $1",
    [user_id]
  );
  res.json(result.rows[0] || null);
});

// ── گرفتن همه کاربران (فقط Admin) ──
app.get("/users", async (req, res) => {
  const { user_id } = req.query;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [user_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  const result = await pool.query("SELECT * FROM profiles ORDER BY role ASC");
  res.json(result.rows);
});

// ── اضافه کردن کاربر (فقط Admin) ──
app.post("/users", async (req, res) => {
  const { admin_id, email, full_name, role, password } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  try {
    // ساخت کاربر با REST API مستقیم
    const response = await fetch(
      'https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "خطا در ساخت کاربر");

    await pool.query(
      "INSERT INTO profiles (id, email, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET full_name = $3, role = $4",
      [data.id, email, full_name, role]
    );

    res.json({ message: "کاربر اضافه شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── آپدیت سطح دسترسی کاربر (فقط Admin) ──
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id, role, full_name } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  const result = await pool.query(
    "UPDATE profiles SET role = $1, full_name = $2 WHERE id = $3 RETURNING *",
    [role, full_name, id]
  );
  res.json(result.rows[0]);
});

// ── حذف کاربر (فقط Admin) ──
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  await pool.query("DELETE FROM profiles WHERE id = $1", [id]);
  res.json({ message: "کاربر حذف شد" });
});

// ── GET همه مخاطبین با فیلتر سطح دسترسی ──
app.get("/contacts", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [user_id]);
  const userRole = profile.rows[0]?.role || 4;

  let result;
  if (userRole === 1 || userRole === 2) {
    // سطح ۱ و ۲ همه مخاطبین رو میبینن (۲ بجز visibility=1)
    if (userRole === 1) {
      result = await pool.query(
        "SELECT * FROM contacts WHERE user_id = $1 ORDER BY id DESC",
        [user_id]
      );
    } else {
      result = await pool.query(
        "SELECT * FROM contacts WHERE user_id = $1 AND visibility > 1 ORDER BY id DESC",
        [user_id]
      );
    }
  } else if (userRole === 3) {
    result = await pool.query(
      "SELECT * FROM contacts WHERE user_id = $1 AND visibility >= 3 ORDER BY id DESC",
      [user_id]
    );
  } else {
    result = await pool.query(
      "SELECT * FROM contacts WHERE user_id = $1 AND visibility = 4 ORDER BY id DESC",
      [user_id]
    );
  }
  res.json(result.rows);
});

// ── GET یک مخاطب ──
app.get("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT * FROM contacts WHERE id = $1", [id]);
  res.json(result.rows[0]);
});

// ── POST اضافه کردن مخاطب ──
app.post("/users", async (req, res) => {
  const { admin_id, email, full_name, role, password } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    await pool.query(
      "INSERT INTO profiles (id, email, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET full_name = $3, role = $4",
      [data.user.id, email, full_name, role]
    );

    res.json({ message: "کاربر اضافه شد", user: data.user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PUT ویرایش مخاطب ──
app.put("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const { name, phone, category, date, visibility } = req.body;
  const result = await pool.query(
    "UPDATE contacts SET name = $1, phone = $2, category = $3, date = $4, visibility = $5 WHERE id = $6 RETURNING *",
    [name, phone, category || "Other", date || "", visibility || 4, id]
  );
  res.json(result.rows[0]);
});

// ── DELETE حذف مخاطب ──
app.delete("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM contacts WHERE id = $1", [id]);
  res.json({ message: "مخاطب حذف شد" });
});

app.listen(3001, () => {
  console.log("Server is running on port 3001");
});