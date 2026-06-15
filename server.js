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

// ── ثبت‌نام درخواستی ──
app.post("/register-request", async (req, res) => {
  const { full_name, phone, email, password } = req.body;
  try {
    // چک کن ایمیل قبلاً درخواست داده یا نه
    const existing = await pool.query(
      "SELECT id FROM contact_requests WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "این ایمیل قبلاً درخواست داده است" });
    }

    // ذخیره درخواست با پسورد
    await pool.query(
      "INSERT INTO contact_requests (full_name, phone, email, password_hash, status) VALUES ($1, $2, $3, $4, 'pending')",
      [full_name, phone, email, password]
    );

    res.json({ message: "درخواست ثبت شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── گرفتن پروفایل کاربر ──
app.get("/profile/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const result = await pool.query("SELECT * FROM profiles WHERE id = $1", [user_id]);
  res.json(result.rows[0] || null);
});

// ── آپدیت پروفایل کاربر ──
app.put("/profile/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const { full_name, phone } = req.body;
  const result = await pool.query(
    "UPDATE profiles SET full_name = $1, phone = $2 WHERE id = $3 RETURNING *",
    [full_name, phone, user_id]
  );
  res.json(result.rows[0]);
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
    const response = await fetch(
      'https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));

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

// ── ریست رمز کاربر (فقط Admin) ──
app.put("/users/:id/reset-password", async (req, res) => {
  const { id } = req.params;
  const { admin_id, new_password } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  try {
    const response = await fetch(
      `https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users/${id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ password: new_password }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    res.json({ message: "رمز عبور ریست شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// ── گرفتن درخواست یه کاربر خاص ──
app.get("/contact-requests/user/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const result = await pool.query(
    "SELECT * FROM contact_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [user_id]
  );
  res.json(result.rows[0] || null);
});

// ── گرفتن همه درخواست‌ها (فقط Admin) ──
app.get("/contact-requests", async (req, res) => {
  const { user_id } = req.query;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [user_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }
  const result = await pool.query(
    "SELECT * FROM contact_requests ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

// ── ارسال درخواست توسط کاربر ──
app.post("/contact-requests", async (req, res) => {
  const { user_id, full_name, phone } = req.body;
  const existing = await pool.query(
    "SELECT id FROM contact_requests WHERE user_id = $1 AND status = 'pending'",
    [user_id]
  );
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: "شما قبلاً درخواست ارسال کرده‌اید" });
  }
  const result = await pool.query(
    "INSERT INTO contact_requests (user_id, full_name, phone) VALUES ($1, $2, $3) RETURNING *",
    [user_id, full_name, phone]
  );
  res.json(result.rows[0]);
});

// ── تایید یا رد درخواست ثبت‌نام (فقط Admin) ──
app.put("/contact-requests/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id, status, visibility, user_role } = req.body;
  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [admin_id]);
  if (!profile.rows[0] || profile.rows[0].role !== 1) {
    return res.status(403).json({ error: "دسترسی ندارید" });
  }

  const request = await pool.query("SELECT * FROM contact_requests WHERE id = $1", [id]);
  const req_data = request.rows[0];

  if (status === 'approved') {
    // اگه درخواست ثبت‌نام باشه (auth_user_id نداره)
    if (!req_data.auth_user_id && req_data.email) {
      // ساخت کاربر توی Supabase
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
            email: req_data.email,
            password: req_data.password_hash,
            email_confirm: true,
          }),
        }
      );
      const userData = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(userData));

      // ساخت پروفایل
      await pool.query(
        "INSERT INTO profiles (id, email, full_name, phone, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET full_name = $3, phone = $4, role = $5",
        [userData.id, req_data.email, req_data.full_name, req_data.phone, user_role || 4]
      );

      // اضافه کردن شماره به مخاطبین
      await pool.query(
        "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)",
        [req_data.full_name, req_data.phone, 'Other', new Date().toDateString(), userData.id, visibility || 4]
      );

      await pool.query(
        "UPDATE contact_requests SET status = $1, visibility = $2, user_role = $3, auth_user_id = $4 WHERE id = $5",
        [status, visibility, user_role, userData.id, id]
      );
    } else {
      // درخواست اضافه شدن به مخاطبین
      await pool.query(
        "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)",
        [req_data.full_name, req_data.phone, 'Other', new Date().toDateString(), req_data.user_id, visibility || 4]
      );
      await pool.query(
        "UPDATE contact_requests SET status = $1, visibility = $2 WHERE id = $3",
        [status, visibility, id]
      );
    }
  } else {
    await pool.query(
      "UPDATE contact_requests SET status = $1 WHERE id = $2",
      [status, id]
    );
  }

  res.json({ message: status === 'approved' ? "تایید شد" : "رد شد" });
});

// ── GET همه مخاطبین با فیلتر سطح دسترسی ──
app.get("/contacts", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);

  const profile = await pool.query("SELECT role FROM profiles WHERE id = $1", [user_id]);
  const userRole = profile.rows[0]?.role || 4;

  let result;
  if (userRole === 1) {
    result = await pool.query("SELECT * FROM contacts ORDER BY id DESC");
  } else if (userRole === 2) {
    result = await pool.query("SELECT * FROM contacts WHERE visibility >= 2 ORDER BY id DESC");
  } else if (userRole === 3) {
    result = await pool.query("SELECT * FROM contacts WHERE visibility >= 3 ORDER BY id DESC");
  } else {
    result = await pool.query("SELECT * FROM contacts WHERE visibility = 4 ORDER BY id DESC");
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
app.post("/contacts", async (req, res) => {
  const { name, phone, category, date, user_id, visibility } = req.body;
  const result = await pool.query(
    "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [name, phone, category || "Other", date || "", user_id, visibility || 4]
  );
  res.json(result.rows[0]);
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

// ── GET همه وظایف کاربر ──
app.get("/tasks", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  const result = await pool.query(
    "SELECT * FROM tasks WHERE user_id = $1 ORDER BY priority ASC, created_at DESC",
    [user_id]
  );
  res.json(result.rows);
});

// ── POST اضافه کردن وظیفه ──
app.post("/tasks", async (req, res) => {
  const { user_id, title, description, priority, due_date, start_time, end_time } = req.body;
  const result = await pool.query(
    "INSERT INTO tasks (user_id, title, description, priority, due_date, start_time, end_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [user_id, title, description || "", priority || 2, due_date || null, start_time || null, end_time || null]
  );
  res.json(result.rows[0]);
});

// ── PUT آپدیت وظیفه ──
app.put("/tasks/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, due_date, start_time, end_time } = req.body;
  const result = await pool.query(
    "UPDATE tasks SET title = $1, description = $2, status = $3, priority = $4, due_date = $5, start_time = $6, end_time = $7 WHERE id = $8 RETURNING *",
    [title, description || "", status || "pending", priority || 2, due_date || null, start_time || null, end_time || null, id]
  );
  res.json(result.rows[0]);
});

// ── DELETE حذف وظیفه ──
app.delete("/tasks/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
  res.json({ message: "وظیفه حذف شد" });
});

app.listen(3001, () => {
  console.log("Server is running on port 3001");
});