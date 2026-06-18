const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jalaali = require("jalaali-js");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: "postgresql://postgres.zgnpjwczcnbbhpwrdbbg:HHHH@mid1376@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
  max: 1
});

// ── helper: چک سطح دسترسی ──
async function getRole(user_id) {
  if (!user_id) return null;
  const r = await pool.query("SELECT role FROM profiles WHERE id = $1", [user_id]);
  return r.rows[0]?.role || null;
}

// ══════════════════════════════════════════
// AUTH / REGISTER
// ══════════════════════════════════════════

// ── ثبت‌نام درخواستی ──
app.post("/register-request", async (req, res) => {
  const { full_name, phone, email, password, username } = req.body;
  try {
    const existing = await pool.query(
      "SELECT id FROM contact_requests WHERE email = $1", [email]
    );
    if (existing.rows.length > 0)
      return res.status(400).json({ error: "این ایمیل قبلاً درخواست داده است" });

    // چک یکتا بودن username
    if (username) {
      const uCheck = await pool.query(
        "SELECT id FROM profiles WHERE username = $1", [username]
      );
      if (uCheck.rows.length > 0)
        return res.status(400).json({ error: "این نام کاربری قبلاً استفاده شده است" });
    }

    await pool.query(
      "INSERT INTO contact_requests (full_name, phone, email, password_hash, status, username) VALUES ($1, $2, $3, $4, 'pending', $5)",
      [full_name, phone, email, password, username || null]
    );
    res.json({ message: "درخواست ثبت شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── لاگین با username ──
app.post("/login-username", async (req, res) => {
  const { username, password } = req.body;
  try {
    // پیدا کردن ایمیل از username
    const r = await pool.query(
      "SELECT email FROM profiles WHERE username = $1", [username]
    );
    if (!r.rows[0])
      return res.status(400).json({ error: "نام کاربری یافت نشد" });
    res.json({ email: r.rows[0].email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── چک یکتا بودن username ──
app.get("/check-username/:username", async (req, res) => {
  const { username } = req.params;
  const r = await pool.query(
    "SELECT id FROM profiles WHERE username = $1", [username]
  );
  res.json({ available: r.rows.length === 0 });
});

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════

// ── گرفتن پروفایل کاربر ──
app.get("/profile/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const result = await pool.query("SELECT * FROM profiles WHERE id = $1", [user_id]);
  res.json(result.rows[0] || null);
});

// ── آپدیت پروفایل کاربر (شامل username) ──
app.put("/profile/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const { full_name, phone, username } = req.body;
  try {
    // چک یکتا بودن username
    if (username) {
      const uCheck = await pool.query(
        "SELECT id FROM profiles WHERE username = $1 AND id != $2", [username, user_id]
      );
      if (uCheck.rows.length > 0)
        return res.status(400).json({ error: "این نام کاربری قبلاً استفاده شده است" });
    }
    const result = await pool.query(
      "UPDATE profiles SET full_name = $1, phone = $2, username = $3 WHERE id = $4 RETURNING *",
      [full_name, phone, username || null, user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// USERS (Admin only)
// ══════════════════════════════════════════

// ── گرفتن همه کاربران ──
app.get("/users", async (req, res) => {
  const role = await getRole(req.query.user_id);
  if (role !== 1) return res.status(403).json({ error: "دسترسی ندارید" });
  const result = await pool.query(`SELECT p.*, m.full_name as manager_name FROM profiles p LEFT JOIN profiles m ON p.manager_id = m.id ORDER BY p.role ASC, p.full_name ASC`);
  res.json(result.rows);
});

// ── اضافه کردن کاربر (فقط Admin) ──
app.post("/users", async (req, res) => {
  const { admin_id, email, full_name, role, password, phone, visibility, username, manager_id, department } = req.body;
  const adminRole = await getRole(admin_id);
  if (adminRole !== 1) return res.status(403).json({ error: "دسترسی ندارید" });

  try {
    if (username) {
      const uCheck = await pool.query("SELECT id FROM profiles WHERE username = $1", [username]);
      if (uCheck.rows.length > 0)
        return res.status(400).json({ error: "این نام کاربری قبلاً استفاده شده است" });
    }

    const response = await fetch(
      "https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));

    await pool.query(
      `INSERT INTO profiles (id, email, full_name, role, phone, username, manager_id, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE
       SET full_name = $3, role = $4, phone = $5, username = $6, manager_id = $7, department = $8`,
      [data.id, email, full_name, role, phone || null, username || null, manager_id || null, department || null]
    );

    if (phone) {
      await pool.query(
        "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)",
        [full_name, phone, department || "اداری", new Date().toDateString(), data.id, visibility || 4]
      );
    }

    res.json({ message: "کاربر اضافه شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── آپدیت سطح دسترسی کاربر ──
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id, role, full_name, manager_id, department } = req.body;
  const adminRole = await getRole(admin_id);
  if (adminRole !== 1) return res.status(403).json({ error: "دسترسی ندارید" });
  const result = await pool.query(
    "UPDATE profiles SET role = $1, full_name = $2, manager_id = $3, department = $4 WHERE id = $5 RETURNING *",
    [role, full_name, manager_id || null, department || null, id]
  );
  res.json(result.rows[0]);
});

// ── ریست رمز کاربر ──
app.put("/users/:id/reset-password", async (req, res) => {
  const { id } = req.params;
  const { admin_id, new_password } = req.body;
  const adminRole = await getRole(admin_id);
  if (adminRole !== 1) return res.status(403).json({ error: "دسترسی ندارید" });
  try {
    const response = await fetch(
      `https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users/${id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
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

// ── حذف کاربر ──
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id } = req.body;
  const adminRole = await getRole(admin_id);
  if (adminRole !== 1) return res.status(403).json({ error: "دسترسی ندارید" });
  await pool.query("DELETE FROM profiles WHERE id = $1", [id]);
  res.json({ message: "کاربر حذف شد" });
});

// ══════════════════════════════════════════
// CONTACT REQUESTS
// ══════════════════════════════════════════

app.get("/contact-requests/user/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const result = await pool.query(
    "SELECT * FROM contact_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [user_id]
  );
  res.json(result.rows[0] || null);
});

app.get("/contact-requests", async (req, res) => {
  const role = await getRole(req.query.user_id);
  if (role !== 1) return res.status(403).json({ error: "دسترسی ندارید" });
  const result = await pool.query("SELECT * FROM contact_requests ORDER BY created_at DESC");
  res.json(result.rows);
});

app.post("/contact-requests", async (req, res) => {
  const { user_id, full_name, phone } = req.body;
  const existing = await pool.query(
    "SELECT id FROM contact_requests WHERE user_id = $1 AND status = 'pending'", [user_id]
  );
  if (existing.rows.length > 0)
    return res.status(400).json({ error: "شما قبلاً درخواست ارسال کرده‌اید" });
  const result = await pool.query(
    "INSERT INTO contact_requests (user_id, full_name, phone) VALUES ($1, $2, $3) RETURNING *",
    [user_id, full_name, phone]
  );
  res.json(result.rows[0]);
});

app.put("/contact-requests/:id", async (req, res) => {
  const { id } = req.params;
  const { admin_id, status, visibility, user_role } = req.body;
  const adminRole = await getRole(admin_id);
  if (adminRole !== 1) return res.status(403).json({ error: "دسترسی ندارید" });

  const request = await pool.query("SELECT * FROM contact_requests WHERE id = $1", [id]);
  const req_data = request.rows[0];

  if (status === "approved") {
    if (!req_data.auth_user_id && req_data.email) {
      const response = await fetch(
        "https://zgnpjwczcnbbhpwrdbbg.supabase.co/auth/v1/admin/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": process.env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
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

      await pool.query(
        `INSERT INTO profiles (id, email, full_name, phone, role, username)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
         SET full_name = $3, phone = $4, role = $5, username = $6`,
        [userData.id, req_data.email, req_data.full_name, req_data.phone, user_role || 4, req_data.username || null]
      );

      await pool.query(
        "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)",
        [req_data.full_name, req_data.phone, "اداری", new Date().toDateString(), userData.id, visibility || 4]
      );

      await pool.query(
        "UPDATE contact_requests SET status = $1, visibility = $2, user_role = $3, auth_user_id = $4 WHERE id = $5",
        [status, visibility, user_role, userData.id, id]
      );
    } else {
      await pool.query(
        "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)",
        [req_data.full_name, req_data.phone, "اداری", new Date().toDateString(), req_data.user_id, visibility || 4]
      );
      await pool.query(
        "UPDATE contact_requests SET status = $1, visibility = $2 WHERE id = $3",
        [status, visibility, id]
      );
    }
  } else {
    await pool.query("UPDATE contact_requests SET status = $1 WHERE id = $2", [status, id]);
  }

  res.json({ message: status === "approved" ? "تایید شد" : "رد شد" });
});

// ══════════════════════════════════════════
// CONTACTS — با دسترسی‌های جدید
// role=1: همه + حذف
// role=2: visibility>=2 + افزودن + ویرایش (بدون حذف)
// role=3,4: فقط دیدن (بر اساس visibility)
// ══════════════════════════════════════════

app.get("/contacts", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  const role = await getRole(user_id);
  let result;
  if (role === 1)      result = await pool.query("SELECT * FROM contacts ORDER BY name ASC");
  else if (role === 2) result = await pool.query("SELECT * FROM contacts WHERE visibility >= 2 ORDER BY name ASC");
  else if (role === 3) result = await pool.query("SELECT * FROM contacts WHERE visibility >= 3 ORDER BY name ASC");
  else                 result = await pool.query("SELECT * FROM contacts WHERE visibility = 4 ORDER BY name ASC");
  res.json(result.rows);
});

app.get("/contacts/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM contacts WHERE id = $1", [req.params.id]);
  res.json(result.rows[0]);
});

// ── افزودن مخاطب — role 1 و 2 ──
app.post("/contacts", async (req, res) => {
  const { name, phone, category, date, user_id, visibility } = req.body;
  const role = await getRole(user_id);
  if (role !== 1 && role !== 2)
    return res.status(403).json({ error: "دسترسی ندارید" });
  const result = await pool.query(
    "INSERT INTO contacts (name, phone, category, date, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [name, phone, category || "اداری", date || "", user_id, visibility || 4]
  );
  res.json(result.rows[0]);
});

// ── ویرایش مخاطب — role 1 و 2 ──
app.put("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const { name, phone, category, date, visibility, user_id } = req.body;
  const role = await getRole(user_id);
  if (role !== 1 && role !== 2)
    return res.status(403).json({ error: "دسترسی ندارید" });
  const result = await pool.query(
    "UPDATE contacts SET name = $1, phone = $2, category = $3, date = $4, visibility = $5 WHERE id = $6 RETURNING *",
    [name, phone, category || "اداری", date || "", visibility || 4, id]
  );
  res.json(result.rows[0]);
});

// ── حذف مخاطب — فقط role 1 ──
app.delete("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  const role = await getRole(user_id);
  if (role !== 1)
    return res.status(403).json({ error: "فقط مدیر ارشد می‌تواند مخاطب را حذف کند" });
  await pool.query("DELETE FROM contacts WHERE id = $1", [id]);
  res.json({ message: "مخاطب حذف شد" });
});

// ══════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════

app.get("/tasks", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  const result = await pool.query(
    "SELECT * FROM tasks WHERE user_id = $1 ORDER BY priority ASC, created_at DESC", [user_id]
  );
  res.json(result.rows);
});

app.post("/tasks", async (req, res) => {
  const { user_id, title, description, priority, due_date, start_time, end_time } = req.body;
  const result = await pool.query(
    "INSERT INTO tasks (user_id, title, description, priority, due_date, start_time, end_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [user_id, title, description || "", priority || 2, due_date || null, start_time || null, end_time || null]
  );
  res.json(result.rows[0]);
});

app.put("/tasks/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, due_date, start_time, end_time } = req.body;
  const result = await pool.query(
    "UPDATE tasks SET title=$1, description=$2, status=$3, priority=$4, due_date=$5, start_time=$6, end_time=$7 WHERE id=$8 RETURNING *",
    [title, description || "", status || "pending", priority || 2, due_date || null, start_time || null, end_time || null, id]
  );
  res.json(result.rows[0]);
});

app.delete("/tasks/:id", async (req, res) => {
  await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
  res.json({ message: "وظیفه حذف شد" });
});

// ══════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════

app.get("/events", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  const result = await pool.query(
    "SELECT * FROM events WHERE user_id = $1 ORDER BY date ASC, start_time ASC", [user_id]
  );
  res.json(result.rows);
});

app.post("/events", async (req, res) => {
  const { user_id, title, description, date, start_time, end_time, type } = req.body;
  const result = await pool.query(
    "INSERT INTO events (user_id, title, description, date, start_time, end_time, type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [user_id, title, description || "", date, start_time || null, end_time || null, type || "meeting"]
  );
  res.json(result.rows[0]);
});

app.put("/events/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, date, start_time, end_time, type } = req.body;
  const result = await pool.query(
    "UPDATE events SET title=$1, description=$2, date=$3, start_time=$4, end_time=$5, type=$6 WHERE id=$7 RETURNING *",
    [title, description || "", date, start_time || null, end_time || null, type || "meeting", id]
  );
  res.json(result.rows[0]);
});

app.delete("/events/:id", async (req, res) => {
  await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
  res.json({ message: "رویداد حذف شد" });
});

// ══════════════════════════════════════════
// REPORTS — گزارش عملکرد
// ══════════════════════════════════════════

// ── helper: محاسبه عملکرد یک کاربر ──
async function getUserPerformance(uid) {
  const [tasks, events] = await Promise.all([
    pool.query("SELECT * FROM tasks WHERE user_id = $1", [uid]),
    pool.query("SELECT * FROM events WHERE user_id = $1", [uid]),
  ]);

  const allTasks    = tasks.rows;
  const done        = allTasks.filter(t => t.status === "done");
  const pending     = allTasks.filter(t => t.status === "pending");
  const urgent      = allTasks.filter(t => t.priority === 1);
  const urgentDone  = urgent.filter(t => t.status === "done");

  // overdue — سررسید گذشته
  const now = new Date();
  const { jy, jm, jd } = jalaali.toJalaali(now);
  const toF = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const todayStr = `${toF(jy)}/${toF(String(jm).padStart(2,"0"))}/${toF(String(jd).padStart(2,"0"))}`;
  const overdue = pending.filter(t => t.due_date && t.due_date < todayStr);

  // آخرین فعالیت
  const lastDone = done.sort((a,b) => new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at))[0];

  return {
    total_tasks:    allTasks.length,
    done_tasks:     done.length,
    pending_tasks:  pending.length,
    overdue_tasks:  overdue.length,
    urgent_tasks:   urgent.length,
    urgent_done:    urgentDone.length,
    done_rate:      allTasks.length > 0 ? Math.round((done.length / allTasks.length) * 100) : 0,
    urgent_rate:    urgent.length > 0 ? Math.round((urgentDone.length / urgent.length) * 100) : 0,
    total_events:   events.rows.length,
    last_activity:  lastDone?.updated_at || lastDone?.created_at || null,
  };
}

// ── گزارش کامل همه کاربران — فقط مدیر ارشد ──
app.get("/reports/all", async (req, res) => {
  const { user_id } = req.query;
  const role = await getRole(user_id);
  if (role !== 1) return res.status(403).json({ error: "دسترسی ندارید" });

  try {
    const users = await pool.query(
      "SELECT id, full_name, email, username, role FROM profiles ORDER BY role ASC, full_name ASC"
    );

    const results = await Promise.all(
      users.rows.map(async (u) => ({
        ...u,
        performance: await getUserPerformance(u.id),
      }))
    );

    // آمار کلی سیستم
    const [allContacts, allTasks, allEvents] = await Promise.all([
      pool.query("SELECT COUNT(*) as count FROM contacts"),
      pool.query("SELECT status, priority, due_date FROM tasks"),
      pool.query("SELECT type, date FROM events"),
    ]);

    res.json({
      users: results,
      system: {
        total_contacts: parseInt(allContacts.rows[0].count),
        total_tasks:    allTasks.rows.length,
        done_tasks:     allTasks.rows.filter(t => t.status === "done").length,
        pending_tasks:  allTasks.rows.filter(t => t.status === "pending").length,
        urgent_tasks:   allTasks.rows.filter(t => t.priority === 1 && t.status === "pending").length,
        total_events:   allEvents.rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── گزارش کارمندان زیرمجموعه — مدیر (role=2) ──
app.get("/reports/team", async (req, res) => {
  const { user_id } = req.query;
  const role = await getRole(user_id);
  if (role !== 2) return res.status(403).json({ error: "دسترسی ندارید" });

  try {
    // کارمندانی که این مدیر رو به عنوان manager_id دارن
    const users = await pool.query(
      "SELECT id, full_name, email, username, role FROM profiles WHERE manager_id = $1 ORDER BY role ASC, full_name ASC",
      [user_id]
    );

    const results = await Promise.all(
      users.rows.map(async (u) => ({
        ...u,
        performance: await getUserPerformance(u.id),
      }))
    );

    res.json({ users: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── گزارش شخصی — همه کاربران ──
app.get("/reports/me", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: "user_id required" });
  try {
    const perf = await getUserPerformance(user_id);
    res.json(perf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── گزارش بر اساس بخش — فقط مدیر ارشد ──
app.get("/reports/departments", async (req, res) => {
  const { user_id } = req.query;
  const role = await getRole(user_id);
  if (role !== 1) return res.status(403).json({ error: "دسترسی ندارید" });

  try {
    const users = await pool.query(`
      SELECT p.*, m.full_name as manager_name
      FROM profiles p
      LEFT JOIN profiles m ON p.manager_id = m.id
      ORDER BY p.department ASC, p.role ASC, p.full_name ASC
    `);

    // گروه‌بندی بر اساس بخش
    const deptMap = {};
    for (const u of users.rows) {
      const dept = u.department || "نامشخص";
      if (!deptMap[dept]) deptMap[dept] = { name: dept, members: [], manager: null };
      deptMap[dept].members.push(u);
      if (u.role <= 2 && !deptMap[dept].manager) deptMap[dept].manager = u.full_name;
    }

    res.json({ departments: Object.values(deptMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// ORGANIZATIONS
// ══════════════════════════════════════════

// ── helper: چک دسترسی مشاهده ──
async function canViewOrg(user_id, visibility) {
  const role = await getRole(user_id);
  if (role === 1) return true;
  if (role === 2 && visibility >= 2) return true;
  if (role === 3 && visibility >= 3) return true;
  if (role === 4 && visibility === 4) return true;
  return false;
}

// ── GET همه سازمان‌ها ──
app.get("/organizations", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  const role = await getRole(user_id);
  let result;
  if (role === 1)      result = await pool.query("SELECT * FROM organizations ORDER BY name ASC");
  else if (role === 2) result = await pool.query("SELECT * FROM organizations WHERE visibility >= 2 ORDER BY name ASC");
  else if (role === 3) result = await pool.query("SELECT * FROM organizations WHERE visibility >= 3 ORDER BY name ASC");
  else                 result = await pool.query("SELECT * FROM organizations WHERE visibility = 4 ORDER BY name ASC");
  res.json(result.rows);
});

// ── GET یک سازمان ──
app.get("/organizations/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT o.*, 
        (SELECT json_agg(c.*) FROM contacts c WHERE c.organization_id = o.id) as contacts
       FROM organizations o WHERE o.id = $1`, [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "سازمان یافت نشد" });
    const org = result.rows[0];
    if (!(await canViewOrg(user_id, org.visibility)))
      return res.status(403).json({ error: "دسترسی ندارید" });
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST افزودن سازمان — role 1 و 2 ──
app.post("/organizations", async (req, res) => {
  const { user_id, name, type, status, national_id, website, address, note,
          phones, emails, main_contact, visibility } = req.body;
  console.log("POST /organizations body:", JSON.stringify(req.body));
  const role = await getRole(user_id);
  if (role !== 1 && role !== 2)
    return res.status(403).json({ error: "دسترسی ندارید" });
  try {
    const phonesStr      = JSON.stringify(Array.isArray(phones) ? phones : []);
    const emailsStr      = JSON.stringify(Array.isArray(emails) ? emails : []);
    const mainContactStr = JSON.stringify(main_contact && typeof main_contact === "object" ? main_contact : {});
    console.log("Inserting with:", { name, type, status, phonesStr, emailsStr, mainContactStr, visibility });
    const result = await pool.query(
      `INSERT INTO organizations 
        (name, type, status, national_id, website, address, note, phones, emails, main_contact, visibility, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12) RETURNING *`,
      [name, type||"other", status||"active", national_id||null, website||null,
       address||null, note||null,
       phonesStr, emailsStr, mainContactStr,
       visibility||4, user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /organizations error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT ویرایش سازمان — role 1 و 2 ──
app.put("/organizations/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id, name, type, status, national_id, website, address, note,
          phones, emails, main_contact, visibility } = req.body;
  const role = await getRole(user_id);
  if (role !== 1 && role !== 2)
    return res.status(403).json({ error: "دسترسی ندارید" });
  try {
    const result = await pool.query(
      `UPDATE organizations SET
        name=$1, type=$2, status=$3, national_id=$4, website=$5,
        address=$6, note=$7, phones=$8::jsonb, emails=$9::jsonb, main_contact=$10::jsonb, visibility=$11
       WHERE id=$12 RETURNING *`,
      [name, type||"other", status||"active", national_id||null, website||null,
       address||null, note||null,
       JSON.stringify(phones||[]), JSON.stringify(emails||[]),
       JSON.stringify(main_contact||{}),
       visibility||4, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE حذف سازمان — فقط role 1 ──
app.delete("/organizations/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  const role = await getRole(user_id);
  if (role !== 1)
    return res.status(403).json({ error: "فقط مدیر ارشد می‌تواند سازمان را حذف کند" });
  try {
    // قبل از حذف، organization_id مخاطبین رو null کن
    await pool.query("UPDATE contacts SET organization_id = NULL WHERE organization_id = $1", [id]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [id]);
    res.json({ message: "سازمان حذف شد" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(3001, () => console.log("Server running on port 3001"));
