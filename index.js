// ══════════════════════════════════════════════════════════════
// §HEADER
// inventory-audit-updater-worker — EcomModa v6.1.0
// Account: ecommoda-dev (762c353004e8472b20261fba273bfe8d)
// D1: DB → ecommoda-dev-logs
//
// skills: worker-builder v3.8.0 · constants v3.1.0 · shopify-graphql-helper v1.0.0 — 24-09-2026
//
// CHANGELOG v6.1.1 (24-09-2026) — الطبقة ٥: الحارس الديناميكي لقيم اللوج
//   🟢 استبدال check-log-values.mjs بالنسخة المصلَّحة (بتمسك object shorthand
//      `{ tool, type }` كمان — النسخة القديمة كانت بتعدّي عليه في صمت)
//   🟢 §LOG-REG: LOG_REGISTRY + isRegisteredLogValue + log_value_alerts UPSERT
//      جوّه writeLog — مفيش رفض كتابة أبدًا، القيمة غير المسجّلة بتاخد
//      extra._unregistered وبتتسجّل في جدول التنبيهات المشترك بعد الكتابة
//   ℹ️ الفحص طلّع الأداة نضيفة أصلاً: ٤ قيم مسجّلة = ٤ مستخدمة، صفر ديناميكي
//
// CHANGELOG v6.1.0 (18-09-2026) — الأرقام تتقرا لحظة المقارنة مش لحظة الفهرس
//   🔴 `bulk_shelf_check` اتشال واتحوّل لـ **`bulk_compare`**: نداء واحد بيرجّع
//      الأرصدة الحيّة (`available`/`committed`/`on_hand` على LOCATION_ID) **و**
//      المغلَّف في **نفس اللحظة** (`at` بترجع في الرد).
//      * السبب: الفهرس بيتحمّل قبل العدّ، فأرقامه بتقدم أثناء جلسة المسح.
//        الكتابة كانت محميّة بالـ CAS، فالخطر مكانش على المخزون — كان إن
//        **الشاشة تعرض رقم قديم** والموظف ياخد قرار عليه.
//      * وبيقفل عيب أدق: الأرصدة كانت من لحظة الفهرس والمغلَّف من لحظة
//        المراجعة — يعني `available + committed − المغلَّف` بتتجمّع من وقتين
//        مختلفين. دلوقتي الاتنين من نفس النداء.
//      * استعلام الأوردرات الغالي بيتنفّذ **بس** للمتغيّرات اللي عليها حجز —
//        الصنف بلا حجز مافيش منه قطع متغلّفة أصلاً.
//   🟠 `getLiveQuantities` — `nodes(ids:)` لكل الدفعة في استعلام واحد، والـ ID
//      اللي مالوش مورد بيرجع «الصنف مش موجود» مش صفر.
//   🟠 `get_bulk_index` بيرجّع `compareChunkHint`/`compareMaxBatch` بدل سقوف
//      المراجعة القديمة.
//
// CHANGELOG v6.0.0 (18-09-2026) — قسم الجرد الجماعي (§BULK)
//   🟢 get_bulk_index: فهرس كل المتغيّرات الصالحة للجرد (باركود + SKU + الرصيد
//      + آخر جرد) في نداء واحد — كل مسحة بقت بحث محلي مش نداء شبكة.
//      + `dupBarcodes`: الباركود المتكرر على أكتر من متغيّر بيرجع صريح بدل ما
//        المسحة تتحسب على أول واحد نلاقيه.
//   🟢 bulk_shelf_check: القطع المغلَّفة مقابل اللي لسه على الرف، باستعلام
//      **لكل منتج** مش لكل مقاس. (اتحوّل لـ bulk_compare في v6.1.0.)
//   🟢 bulk_adjust: كتابة جماعية بـ `inventorySetQuantities` + `changeFromQuantity`
//      (compare-and-swap) بدل الـ delta النسبي — الصنف اللي رصيده اتغيّر بين
//      العدّ والتنفيذ بيترفض من شوبيفاي **من غير أي أثر على المخزون** بدل ما
//      التعديل يتطبّق على رصيد تاني. ودي كمان الحماية من الضغطة التانية.
//      صف D1 واحد بالظبط لكل عنصر · التحقق كله قبل أول كتابة · حارس تكرار
//      بالكيان · عقد ترتيب `results[]` معلن.
//   ℹ️ مفيش قيمة `type` جديدة — الجماعي بيكتب تحت `adjustment` و`ok` زي الفردي.
//
// CHANGELOG v5.0.0 (12-09-2026) — مراجعة شاملة مقابل المهارات، التفاصيل في AUDIT-12-09-2026.md
//   🔴 adjust_inventory: التسلسل بدل Promise.all + أربع حالات نتيجة
//      * كان: Promise.all([adjustInventory, setAuditMetafields]) — فشل الميتافيلد
//        بعد ما الكمية اتعدّلت كان بيرجّع 500، فالموظف يشوف أحمر ويعيد المحاولة
//        و delta نسبي فالتعديل بيتطبّق مرتين. والـ writeLog ماكانش بيوصله التنفيذ
//        أصلاً فالتعديل اللي حصل مالوش أي صف في D1.
//      * بقى: الفعل اللي مالوش رجعة الأول، والخطوة التكميلية في try/catch → warning،
//        و actions[] بتتملي أول بأول، و writeLog دايمًا بيتنفّذ (بـ logged:false لو فشل)
//   🔴 shopifyGQL: النسخة الكاملة (res.ok · رد مش JSON · data.errors · data فاضية
//      + backoff على THROTTLED) بدل `return res.json()`
//   🔴 تاب السجل: Log Filter Model v2 — get_logs (100/صفحة) + get_logs_count
//      + get_logs_export بـ {cap,total,truncated}، فلترة server-side بقوايم،
//      ترتيب بقائمة بيضاء + كاسر تعادل، واستثناء login/logout في SQL
//   🔴 التوقيت: Intl بـ Africa/Cairo بدل أي إزاحة ثابتة (constants §13)
//   🟠 ?action=diag و ?action=get_config
//   🟠 assertEnv + requireLocationId + حارس WORKER_SECRET الغايب
//   🟠 get_details بيرجّع orderId الرقمي جنب اسم الأوردر
//   🟠 get_audit_priorities: سقف صفحات + truncated بدل سحب مفتوح صامت
//
// CHANGELOG v4.0.0:
//   - listSkus / lookupBarcode: إضافة product.vendor للـ GraphQL query
// CHANGELOG v3.1.0:
//   - getAllVariantsForAudit: inventoryItem.tracked + product.tags + product.title
//   - استثناء Inventory not tracked وتاج Suspended
// CHANGELOG v3.0.0:
//   - endpoint جديد: get_audit_priorities
// CHANGELOG v2.5.0:
//   - منطق حالة التغليف (s1/s2_packed_by) + اكتشاف مرحلة الأوردر S1/S2
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════

const TOOL_NAME      = 'inventory_audit';
const WORKER_VERSION = '6.1.1';

// قيم `type` المسجّلة لهذه الأداة في ecommoda-constants §7:
//   ok · adjustment · login · logout
// ⛔ ممنوع أي writeLog بقيمة مش في السطر ده قبل ما تتسجّل هناك.
// نتيجة العملية بتترحّل في extra.result (المفردات الرسمية → constants §12):
//   success · warning · error   —   already/rejected مش منطبقين على الأداة دي
//   (كل نداء كتابة هنا بيحاول فعل حقيقي؛ مفيش مسار بيتوقف قبل المحاولة).
const LOG_TYPE_ADJUSTMENT = 'adjustment';
const LOG_TYPE_OK         = 'ok';

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥، worker-builder Step 7-ج)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json اللي جنبها — بتتحدّث معاه في نفس
// الـ commit. ممنوع شحن السجل الكامل بتاع كل الأدوات هنا.
const LOG_REGISTRY = {
  inventory_audit: new Set(['login', 'logout', 'adjustment', 'ok']),
};

const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

// UPSERT على (source_tool, tool, type) — صف واحد لكل قيمة، hits بيعدّ.
// الحدث الكامل مش بيضيع: الصف الأصلي موجود في logs وعليه _unregistered،
// والجدول ده فهرس مش سجل تاني — عشان كده dedupe مش صف لكل حدث.
const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

// فشل التنبيه ممنوع يأثر على أي حاجة — try/catch صامت. بتجمّع التكرار
// جوّه نفس الدفعة في صف واحد (hits) قبل ما تكتب.
async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

const S2_VALUES = ['Confirmed + RETURN', 'Confirmed + EXCHANGE', 'Printed', 'Ready'];

// ─── سلسلة السقوف (worker-builder Step 5A ⑪) ────────────────────
// ① الواجهة  CHUNK           = غير منطبق — الأداة دي بتكتب صنف واحد لكل نداء،
//                              مفيش endpoint بياخد مصفوفة، فمفيش تقسيم دفعات.
// ② الـ Worker MAX_BATCH      = غير منطبق لنفس السبب.
// ③ شوبيفاي   VARIANTS_PER_PAGE = 250 — سقف `productVariants` نفسه. الاستعلام
//                              خفيف (variant + مستوى مخزون واحد) فالتكلفة بعيدة
//                              عن سقف الـ 1000 نقطة؛ الحد الفعلي هو عدد الصفحات.
const VARIANTS_PER_PAGE = 250;
// حارس على السحب المفتوح: 40 صفحة × 250 = 10,000 variant. لو المتجر عدّاها،
// الرد بيرجع `truncated: true` — ممنوع نرجّع قايمة ناقصة في السكوت.
const MAX_VARIANT_PAGES = 40;

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). المفاتيح لازم تطابق `data-sort-key` في الواجهة حرفيًا.
const LOG_SORT_COLUMNS = {
  date:         'timestamp',
  time:         'timestamp',
  employee:     'employee',
  sku:          'sku',
  productTitle: 'product_title',
  type:         'type',
  delta:        'delta',
  valueBefore:  'value_before',
  valueAfter:   'value_after',
};

// ══════════════════════════════════════════════════════════════
// §CORS — write tool → strict origins
// ══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];

function getCORS(request) {
  const origin  = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════

function json(data, status = 200, request = null) {
  const cors = request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] };
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── §HELPERS::time — توقيت القاهرة يتحسب، مايتكتبش ثابت ────────
// نفس النسخة بالحرف في الواجهة (constants §13). نسختين مختلفتين = الشاشة
// والسجل بيقولوا وقتين مختلفين لنفس الصف.
const CAIRO_TZ  = 'Africa/Cairo';
const _cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function cairoParts(d) {
  const o = {};
  for (const p of _cairoFmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';        // حارس: بعض المحركات بترجّع 24
  return o;
}
function cairoDate(d = new Date()) {
  const p = cairoParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// ─── §HELPERS::env — المتغيّر الناقص يوقف العملية باسمه ─────────
function assertEnv(env, names) {
  const missing = names.filter(n => {
    const v = env[n];
    return typeof v !== 'string' || !v.trim();
  });
  if (missing.length) {
    throw new Error(
      `متغيّرات ناقصة على الـ Worker: ${missing.join(' · ')} — ` +
      `ضيفها في Settings → Variables and Secrets وبعدها Promote version`
    );
  }
}

// LOCATION_ID الناقص بيتحوّل لـ gid://shopify/Location/undefined وبيفشل جوّه
// الميوتيشن — الأداة دي أداة مخزون فالحارس ده إلزامي قبل أي تعديل.
function requireLocationId(env) {
  assertEnv(env, ['LOCATION_ID']);
  if (!/^\d+$/.test(String(env.LOCATION_ID).trim())) {
    throw new Error(`LOCATION_ID لازم يكون رقم — القيمة الحالية غير صالحة`);
  }
  return `gid://shopify/Location/${String(env.LOCATION_ID).trim()}`;
}

// الـ GID بيتحوّل لرقم — الواجهة محتاجاه عشان تبني لينك صفحة الأوردر
function numericId(gid) {
  const n = String(gid || '').split('/').pop();
  return /^\d+$/.test(n) ? n : null;
}

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify
// EcomModa D1 Pattern v1.3.0
// ══════════════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

async function writeLog(db, entry) {
  // §LOG-REG (worker-builder Step 7-ج) — مفيش رفض كتابة أبدًا. القيمة غير
  // المسجّلة بتاخد extra._unregistered وبتتسجّل في log_value_alerts بعد الكتابة.
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    extra ? JSON.stringify(extra) : null
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);
}

// ⚠️ بنّاء الشرط الوحيد للتلات دوال — فمفيش endpoint بيفلتر بشكل مختلف عن
//    اللي جنبه (وده بالظبط اللي بيخلي التصدير ينزّل غير المعروض).
// ⚠️ أعمدة البحث مخصّصة للأداة دي: سجل الجرد مالوش `order_name` أصلاً،
//    والموظف بيدوّر بالـ SKU أو باسم المنتج أو في الملاحظات.
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null, searchNotes = null,
  dateFrom  = null, dateTo    = null,
  deltaDirs = null, auditCounts = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (sku LIKE ? OR product_title LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (searchNotes) {
    sql += ' AND notes LIKE ?';
    b.push(`%${searchNotes}%`);
  }
  // اتجاه التعديل — كان فلتر client-side على `delta`، وبقى server-side عشان
  // الصفحات والعدّ والتصدير يبقوا متسقين (Standards #31).
  if (Array.isArray(deltaDirs) && deltaDirs.length) {
    const parts = [];
    if (deltaDirs.includes('pos')) parts.push('delta > 0');
    if (deltaDirs.includes('neg')) parts.push('delta < 0');
    if (deltaDirs.includes('zero')) parts.push('(delta = 0 OR delta IS NULL)');
    if (parts.length) sql += ` AND (${parts.join(' OR ')})`;
  }
  // عدد مرات جرد الـ SKU — كان بيتحسب في المتصفح من الصفحة المحمّلة بس، فكان
  // بيقلّل العدد الحقيقي. بقى من القاعدة كلها.
  if (Array.isArray(auditCounts) && auditCounts.length) {
    const exact = auditCounts.filter(c => c !== '10+').map(c => parseInt(c, 10)).filter(Number.isFinite);
    const conds = [];
    if (exact.length) {
      conds.push(`cnt IN (${exact.map(() => '?').join(',')})`);
    }
    if (auditCounts.includes('10+')) conds.push('cnt > 10');
    if (conds.length) {
      sql += ` AND sku IN (
        SELECT sku FROM (
          SELECT sku, COUNT(*) AS cnt FROM logs
          WHERE tool = ? AND type NOT IN ('login','logout') AND sku IS NOT NULL
          GROUP BY sku
        ) WHERE ${conds.join(' OR ')}
      )`;
      b.push(tool);
      if (exact.length) b.push(...exact);
    }
  }
  // ⚠️ `timestamp` مخزّن UTC والعرض بتوقيت القاهرة (+2/+3). فرق الساعتين/التلاتة
  //    ممكن يحط عملية بعد ٩ مساءً بالقاهرة في يوم UTC اللي بعده. مقبول لفلتر
  //    بالأيام — **بس مكتوب**، عشان مايتكتشفش كباج بعدين.
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات،
  //    والصف الواحد ممكن يظهر في صفحتين **أو مايظهرش خالص**.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

const SELECT_WITH_COUNT = `SELECT *, (
  SELECT COUNT(*) FROM logs l2
   WHERE l2.tool = logs.tool AND l2.sku = logs.sku
     AND l2.type NOT IN ('login','logout')
) AS sku_audit_count`;

/** صفحة واحدة للعرض — 100 صف كحد أقصى. ⚠️ ممنوع تستخدمها للتصدير. */
async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL(SELECT_WITH_COUNT, filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

/** العدّ الكلي المطابق للفلاتر — بيتنادى بالتوازي مع getLogs و getLogsExport. */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * كل الصفوف المطابقة للتصدير — لحد LOG_EXPORT_MAX.
 * ⚠️ الدالة دي **بتقص في السكوت** بطبيعتها، فالـ endpoint لازم يرجّع
 *    cap و total و truncated كمان.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL(SELECT_WITH_COUNT, filters);
  // ⚠️ التصدير والعدّ بيتجاهلوا الترتيب عن قصد — تمريره ليهم بيفتح باب اختلاف
  //    مصدر الباراميترات بين النداءات = تصدير مش مطابق للشاشة.
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/** مصدر واحد لقراءة فلاتر السجل من الـ query string — القوايم CSV. */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  const deltaDirs = csv('deltaDirs'), auditCounts = csv('auditCounts');
  return {
    tool,
    deltaDirs:   deltaDirs.length   ? deltaDirs   : null,
    auditCounts: auditCounts.length ? auditCounts : null,
    employees:   employees.length ? employees : null,
    employee:    url.searchParams.get('employee') || null,
    types:       types.length ? types : null,
    type:        url.searchParams.get('type')        || null,
    search:      url.searchParams.get('search')      || null,
    searchNotes: url.searchParams.get('searchNotes') || null,
    dateFrom:    url.searchParams.get('dateFrom')    || null,
    dateTo:      url.searchParams.get('dateTo')      || null,
  };
}

// ══════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════

async function getAccessToken(env) {
  assertEnv(env, ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET']);
  let res;
  try {
    res = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        grant_type:    'client_credentials',
      }),
    });
  } catch (e) {
    throw new Error(`تعذّر الوصول لشوبيفاي (شبكة): ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`فشل OAuth مع شوبيفاي — HTTP ${res.status}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`رد OAuth مش JSON — غالبًا SHOP_DOMAIN غلط: ${text.slice(0, 120)}`); }
  if (!data.access_token) throw new Error('شوبيفاي ما رجّعتش access_token — راجع CLIENT_ID/CLIENT_SECRET');
  return data.access_token;
}

// ─── §SHOPIFY::shopifyGQL — النسخة الكاملة (Step 5A ①) ──────────
// بترمي على: فشل شبكة · HTTP status · رد مش JSON · data.errors · data فاضية.
// + إعادة محاولة على THROTTLED. ⛔ `return res.json()` عطل مش اختصار.
let lastThrottleStatus = null;   // بيتعرض في ?action=diag

async function shopifyGQL(env, token, query, variables = {}, label = 'shopifyGQL') {
  const RETRY_DELAYS = [600, 1400, 2600];
  let attempt = 0;

  for (;;) {
    let res;
    try {
      res = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type':           'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      throw new Error(`${label}: تعذّر الوصول لشوبيفاي (شبكة) — ${e.message}`);
    }

    const text = await res.text();

    if (!res.ok) {
      // 429 = تجاوز حد المعدّل على مستوى HTTP — يستاهل إعادة محاولة
      if (res.status === 429 && attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt++]);
        continue;
      }
      throw new Error(`${label}: شوبيفاي ردّت HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${label}: رد شوبيفاي مش JSON — ${text.slice(0, 160)}`); }

    if (data?.extensions?.cost?.throttleStatus) {
      lastThrottleStatus = data.extensions.cost.throttleStatus;
    }

    // data.errors ممكن تكون مصفوفة (أخطاء GraphQL) أو **نص** (401 مثلاً)
    if (data.errors) {
      const msgs = Array.isArray(data.errors)
        ? data.errors.map(e => e?.message || JSON.stringify(e))
        : [String(data.errors)];
      const joined = msgs.join(' | ');
      const throttled = Array.isArray(data.errors)
        && data.errors.some(e => e?.extensions?.code === 'THROTTLED');
      if (throttled && attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt++]);
        continue;
      }
      throw new Error(`${label}: ${joined}`);
    }

    if (!data.data) throw new Error(`${label}: شوبيفاي رجّعت رد فاضي (data = null)`);

    return data;
  }
}

// ── List SKUs ────────────────────────────────────────────────────────────────
// v4.0.0: إضافة product.vendor (اسم البراند)
// v3.1.0: إضافة product.tags + فلتر Suspended
async function listSkus(env, token, search = '') {
  let queryStr = '';
  if (search) {
    const esc = search.replace(/"/g, '\\"');
    if (search.includes('/')) {
      queryStr = `sku:"${esc}"`;
    } else {
      queryStr = `sku:${esc}* OR product_title:*${esc}*`;
    }
  }
  const gql = `
    query($q: String) {
      productVariants(first: 100, query: $q, sortKey: SKU) {
        nodes {
          id sku barcode displayName
          selectedOptions { name value }
          product {
            id title status tags vendor
            featuredImage { url altText }
          }
          inventoryItem {
            id
            inventoryLevels(first: 1) {
              nodes {
                quantities(names: ["available", "committed", "on_hand"]) {
                  name quantity
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;
  const data = await shopifyGQL(env, token, gql, { q: queryStr || null }, 'listSkus');

  // v3.1.0: استثناء منتجات تاج Suspended من نتائج البحث
  return data.data.productVariants.nodes.filter(
    v => !(v.product?.tags || []).includes('Suspended')
  );
}

// ── Lookup by barcode ─────────────────────────────────────────────────────────
async function lookupBarcode(env, token, barcode) {
  const gql = `
    query($q: String!) {
      productVariants(first: 1, query: $q) {
        nodes {
          id sku barcode displayName
          selectedOptions { name value }
          product {
            id title status tags vendor
            featuredImage { url altText }
          }
          inventoryItem {
            id
            inventoryLevels(first: 1) {
              nodes {
                quantities(names: ["available", "committed", "on_hand"]) {
                  name quantity
                }
              }
            }
          }
        }
      }
    }
  `;
  const data  = await shopifyGQL(env, token, gql, { q: `barcode:${barcode}` }, 'lookupBarcode');
  const nodes = data.data.productVariants.nodes;
  if (!nodes.length) return null;
  const variant = nodes[0];
  // v3.1.0: استثناء منتجات Suspended حتى لو تم مسح باركودها
  if ((variant.product?.tags || []).includes('Suspended')) return null;
  return variant;
}

// ── Get all variants for Priority Audit Queue ────────────────────────────────
// بدون collection filter — كل المنتجات من المتجر
// يستثني: غير ACTIVE · بدون SKU · Inventory not tracked · تاج Suspended
// v5.0.0: سقف صفحات + truncated — السحب المفتوح كان ممكن يرجّع قايمة ناقصة
//         (أو يستهلك وقت الطلب كله) من غير أي إشارة.
async function getAllVariantsForAudit(env, token) {
  const allVariants = [];
  let cursor  = null;
  let hasNext = true;
  let pages   = 0;
  let scanned = 0;

  while (hasNext) {
    if (pages >= MAX_VARIANT_PAGES) {
      return { variants: allVariants, truncated: true, scanned, pages };
    }

    const gql = `
      query GetAllVariants($cursor: String, $n: Int!) {
        productVariants(first: $n, after: $cursor) {
          nodes {
            id
            sku
            product { id status tags title }
            last_audit_date: metafield(namespace: "custom", key: "last_stock_audit_date") { value }
            inventoryItem {
              tracked
              inventoryLevels(first: 1) {
                nodes {
                  quantities(names: ["available", "committed", "on_hand"]) {
                    name quantity
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const data = await shopifyGQL(
      env, token, gql, { cursor, n: VARIANTS_PER_PAGE }, 'getAllVariantsForAudit'
    );

    const { nodes, pageInfo } = data.data.productVariants;
    pages++;
    scanned += nodes.length;

    for (const v of nodes) {
      // استثناء 1: غير ACTIVE
      if (v.product?.status !== 'ACTIVE') continue;
      // استثناء 2: بدون SKU
      if (!v.sku?.trim()) continue;
      // استثناء 3: Inventory not tracked
      if (!v.inventoryItem?.tracked) continue;
      // استثناء 4: تاج Suspended
      if ((v.product?.tags || []).includes('Suspended')) continue;

      const levels = v.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities || [];
      const getQty = name => {
        const found = levels.find(l => l.name === name);
        return found !== undefined ? found.quantity : null;
      };

      allVariants.push({
        variantId:     v.id,
        productId:     v.product.id,
        sku:           v.sku.trim(),
        productTitle:  v.product.title || '',
        available:     getQty('available'),
        committed:     getQty('committed'),
        onHand:        getQty('on_hand'),
        lastAuditDate: v.last_audit_date?.value || null,
      });
    }

    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  return { variants: allVariants, truncated: false, scanned, pages };
}

// ── Get unfulfilled orders — v2.5.0 ──────────────────────────────────────────
// ⚠️ **توأم:** `getShelfBreakdown` في §BULK بيحسب نفس منطق التغليف بالظبط
//    (نفس الاستعلام · نفس استبعاد الملغي والمرتجع · نفس قاعدة S1/S2) بس على
//    المنتج كله مرة واحدة. أي تعديل على المنطق ده لازم يتعمل في الاتنين معًا —
//    اختلافهم = «المتوقع» يطلع رقمين مختلفين في تاب الجرد وفي التاب الجماعي.
// v5.0.0: بيرجّع `orderId` الرقمي جنب `name` عشان الواجهة تبني لينك شوبيفاي
async function getUnfulfilledOrders(env, token, variantId, productId) {
  const productIdNumeric = productId.split('/').pop();
  const allOrders = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const gql = `
      query($q: String!, $after: String) {
        orders(first: 50, query: $q, after: $after, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id legacyResourceId name createdAt tags cancelledAt
            manual_status: metafield(namespace: "custom", key: "manual_status") { value }
            status_2_r_e:  metafield(namespace: "custom", key: "status_2_r_e")  { value }
            s1_packed_by:         metafield(namespace: "custom", key: "s1_packed_by")         { value }
            s1_packing_date_time: metafield(namespace: "custom", key: "s1_packing_date_time") { value }
            s2_packed_by:         metafield(namespace: "custom", key: "s2_packed_by")         { value }
            s2_packing_date_time: metafield(namespace: "custom", key: "s2_packing_date_time") { value }
            lineItems(first: 20) {
              nodes {
                id sku title quantity currentQuantity
                unfulfilledQuantity
                fulfillableQuantity
                variant { id sku selectedOptions { name value } }
              }
            }
            returns(first: 3) {
              nodes {
                id status
                returnLineItems(first: 10) {
                  nodes {
                    ... on ReturnLineItem {
                      quantity
                      fulfillmentLineItem { lineItem { id } }
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const data = await shopifyGQL(env, token, gql, {
      q: `product_id:${productIdNumeric} fulfillment_status:unfulfilled`,
      after: cursor,
    }, 'getUnfulfilledOrders');
    const { nodes, pageInfo } = data.data.orders;

    for (const order of nodes) {
      if (order.cancelledAt) continue;

      const status2re  = order.status_2_r_e?.value || null;
      const orderStage = S2_VALUES.includes(status2re) ? 'S2' : 'S1';

      const packedBy = orderStage === 'S2'
        ? (order.s2_packed_by?.value         || null)
        : (order.s1_packed_by?.value         || null);
      const packingDateTime = orderStage === 'S2'
        ? (order.s2_packing_date_time?.value  || null)
        : (order.s1_packing_date_time?.value  || null);

      const returnedIds = new Set();
      for (const ret of (order.returns?.nodes || [])) {
        for (const rli of (ret.returnLineItems?.nodes || [])) {
          const li = rli.fulfillmentLineItem?.lineItem;
          if (li?.id && (rli.quantity || 0) > 0) returnedIds.add(li.id);
        }
      }

      const matchingItems = (order.lineItems?.nodes || []).filter(li => {
        if (li.variant?.id !== variantId) return false;
        if (returnedIds.has(li.id))       return false;
        return orderStage === 'S2'
          ? li.fulfillableQuantity > 0
          : li.unfulfilledQuantity > 0;
      });

      if (matchingItems.length > 0) {
        allOrders.push({
          id:           order.id,
          // ⚠️ المفتاح `orderId` موحّد في الستاك كله — الواجهة بتقرا الاسم ده
          orderId:      order.legacyResourceId || numericId(order.id),
          name:         order.name,
          createdAt:    order.createdAt,
          tags:         order.tags || [],
          orderStage,
          packedBy,
          packingDateTime,
          items: matchingItems.map(li => ({
            id:                  li.id,
            title:               li.title,
            sku:                 li.variant?.sku || li.sku,
            options:             li.variant?.selectedOptions || [],
            quantity:            li.quantity,
            unfulfilledQuantity: orderStage === 'S2'
              ? li.fulfillableQuantity
              : li.unfulfilledQuantity,
          })),
        });
      }
    }

    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  return allOrders;
}

// ── Get audit metafields ──────────────────────────────────────────────────────
async function getAuditMetafields(env, token, variantId) {
  const gql = `
    query($id: ID!) {
      productVariant(id: $id) {
        auditDate:     metafield(namespace: "custom", key: "last_stock_audit_date")     { value }
        auditEmployee: metafield(namespace: "custom", key: "last_stock_audit_employee") { value }
        auditNotes:    metafield(namespace: "custom", key: "last_stock_audit_notes")    { value }
      }
    }
  `;
  const data = await shopifyGQL(env, token, gql, { id: variantId }, 'getAuditMetafields');
  const v = data.data?.productVariant;
  return {
    auditDate:     v?.auditDate?.value     || null,
    auditEmployee: v?.auditEmployee?.value || null,
    auditNotes:    v?.auditNotes?.value    || null,
  };
}

// ── Set audit metafields ──────────────────────────────────────────────────────
// الفحوصات التلاتة (Step 5A ②): top-level → userErrors → تأكيد الـ payload
async function setAuditMetafields(env, token, variantId, employee, notes) {
  const now = new Date().toISOString();

  const metafields = [
    {
      ownerId:   variantId,
      namespace: 'custom',
      key:       'last_stock_audit_date',
      type:      'date_time',
      value:     now,
    },
    {
      ownerId:   variantId,
      namespace: 'custom',
      key:       'last_stock_audit_employee',
      value:     employee || '',
    },
  ];

  if (notes && notes.trim()) {
    metafields.push({
      ownerId:   variantId,
      namespace: 'custom',
      key:       'last_stock_audit_notes',
      value:     notes.trim(),
    });
  }

  const gql = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message code }
      }
    }
  `;
  const data   = await shopifyGQL(env, token, gql, { metafields }, 'metafieldsSet');
  const result = data.data?.metafieldsSet;

  const userErrors = result?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error('metafieldsSet: ' + userErrors.map(e => e.message).join(' | '));
  }
  // ③ userErrors فاضية معناها «مفيش اعتراض» مش «اتنفّذت»
  if (!result?.metafields?.length) {
    throw new Error('metafieldsSet: شوبيفاي ما أكدتش كتابة الميتافيلد');
  }
  return { auditDate: now, written: result.metafields.length };
}

// ── Adjust inventory ──────────────────────────────────────────────────────────
// ⚠️ الفعل ده **مالوش رجعة** — أي تحقق ممكن يتعمل بيتعمل قبله (Step 5A ⑩①)
async function adjustInventory(env, token, inventoryItemId, delta) {
  const locationId   = requireLocationId(env);
  const now          = new Date().toISOString();
  const referenceUri = `gid://Stock-Audit-Tool/StockCount/${now}`;

  const adjustGql = `
    mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors { field message }
        inventoryAdjustmentGroup {
          createdAt reason
          changes { name delta }
        }
      }
    }
  `;
  const adjustData = await shopifyGQL(env, token, adjustGql, {
    input: {
      reason:               'correction',
      name:                 'available',
      referenceDocumentUri: referenceUri,
      changes: [{ delta: parseInt(delta, 10), inventoryItemId, locationId }],
    },
  }, 'inventoryAdjustQuantities');

  const result     = adjustData.data?.inventoryAdjustQuantities;
  const userErrors = result?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error('inventoryAdjustQuantities: ' + userErrors.map(e => e.message).join(' | '));
  }
  // ③ تأكيد الـ payload — مجموعة تعديل فاضية معناها إن حاجة ما حصلتش
  const group = result?.inventoryAdjustmentGroup;
  if (!group?.changes?.length) {
    throw new Error('inventoryAdjustQuantities: شوبيفاي ما أكدتش تعديل الكمية');
  }
  return group;
}

// ══════════════════════════════════════════════════════════════
// §BULK — الجرد الجماعي (v6.0.0)
// ══════════════════════════════════════════════════════════════
//
// الفرق الجوهري عن مسار الصنف الواحد فوق:
//
//   مسار الصنف الواحد : `inventoryAdjustQuantities` بـ delta **نسبي**.
//                        إعادة التنفيذ بتضاعف التعديل (فخ موثّق في CLAUDE.md).
//   المسار الجماعي     : `inventorySetQuantities` بقيمة **مطلقة** +
//                        `changeFromQuantity` = compare-and-swap.
//
// ليه الفرق ده إلزامي هنا تحديدًا: في الجرد الجماعي بيعدّي وقت طويل بين لحظة
// العدّ على الرف ولحظة الضغط على «نفّذ» (جلسة مسح كاملة = دقايق لساعات)، وفي
// الوقت ده ممكن تتباع قطعة أو تتشحن. مع الـ delta النسبي الفرق ده بيتطبّق على
// رصيد اتغيّر — يعني **تعديل غلط بصمت**. مع الـ CAS شوبيفاي نفسها بترفض الصنف
// اللي رصيده اتغيّر (`CHANGE_FROM_QUANTITY_STALE`) و**مفيش أي أثر على المخزون**،
// والصنف بيرجع للموظف بـ `error` ورسالة بتقوله يعيد عدّه لوحده.
//
// ⚠️ ودي كمان الحماية من الضغطة التانية: إعادة تنفيذ نفس الدفعة **بتفشل**
//    على الأصناف اللي اتنفّذت خلاص بدل ما تضاعف التعديل.

// ─── سلسلة السقوف التلاتة للقسم الجماعي (worker-builder Step 5A ⑪) ───
// ⛔ ولا رقم منهم يتقال لوحده — تلات حدود فيزيائية على تلات محطات.
//
// ① الواجهة  BULK_CHUNK          = 10  ← **وقت**: الصنف بياخد نداءين متتابعين
//                                  (inventorySetQuantities + metafieldsSet)
//                                  ≈ ٠٫٩ ث/صنف → ٩ ث للنداء الواحد.
//                                  الرقم عايش في الواجهة، وبيترجع هنا في
//                                  `get_bulk_index.chunkHint` عشان مصدر واحد.
// ② الـ Worker BULK_MAX_BATCH     = 50  ← **حارس لصق** (Paid: 10k subrequest).
//                                  الواجهة الملتزمة عمرها ما هتبعت أكتر من ①.
// ③ شوبيفاي   —                      ← الكتابة **ميوتيشن لكل صنف**، مش دفعة
//                                  واحدة، فمفيش `ITEMS_PER_QUERY` هنا:
//                                  `inventorySetQuantities` بترفض الدفعة
//                                  **بالكامل** لو صنف واحد جواها stale
//                                  (`NO_DUPLICATE_INVENTORY_ITEM_ID_GROUP_ID_PAIR`
//                                  و`CHANGE_FROM_QUANTITY_STALE` على مستوى
//                                  الميوتيشن)، ولمّ نتيجة الدفعة في علم واحد
//                                  ممنوع (Step 5A ② «تحقق لكل كيان»).
const BULK_CHUNK          = 10;
const BULK_MAX_BATCH      = 50;

// ④ المقارنة (`bulk_compare`): نداء واحد بيجيب **الأرصدة الحيّة** و**المغلَّف**
//    في نفس اللحظة. التكلفة غير متجانسة عن قصد:
//      · الأرصدة: `nodes(ids:)` رخيص — كل المتغيّرات في استعلام واحد.
//      · المغلَّف: استعلام `orders` لكل **منتج** فيه بلوك `returns` الغالي
//        (~١٠٨ نقطة للأوردر) — وبيتنفّذ **بس** للمتغيّرات اللي عليها حجز.
//    فالوقت للعنصر بيتراوح بين ٠٫٠٥ ث (بلا حجز) و~٠٫٨ ث (معاه)، والسقف
//    محسوب على **الأسوأ**: 10 ÷ 0.8 ≈ 12.
const BULK_COMPARE_MAX_BATCH = 30;
const BULK_COMPARE_CHUNK     = 12;

// سبب التعديل في سجل مخزون شوبيفاي — القيمة الرسمية لجرد الرفوف.
// (مسار الصنف الواحد بيستخدم `correction`؛ الفصل مقصود عشان تاريخ المخزون
//  في شوبيفاي يفرّق بين التصحيح الفردي والجرد الجماعي.)
const BULK_ADJUST_REASON = 'cycle_count_available';

// ─── §BULK::getBulkIndex — فهرس الباركود لجلسة المسح ───
// بيرجّع **كل** متغيّر صالح للجرد مرة واحدة، عشان كل مسحة تبقى بحث محلي في
// Map بدل نداء شبكة. نفس استثناءات `getAllVariantsForAudit`:
//   غير ACTIVE · بدون SKU · Inventory not tracked · تاج Suspended
//
// 🔴 `dupBarcodes` مش تفصيلة — هو الحارس اللي بيمنع أخطر فشل صامت في القسم ده:
//    باركود واحد على أكتر من متغيّر (مقاسين بنفس الباركود مثلاً). من غيره
//    المسحة كانت هتتحسب على **أول** متغيّر لاقيناه، فالجرد يطلع مظبوط على
//    الغلط والرصيد يتعدّل على متغيّر تاني خالص.
async function getBulkIndex(env, token) {
  // 🔴 الأرقام لازم تبقى بتاعة **الموقع اللي هنكتب عليه**، مش أول موقع في القايمة.
  //    باقي الأداة بتستخدم `inventoryLevels(first: 1)` — وده مقبول في متجر بموقع
  //    واحد، لكن في الجرد الجماعي معناه مئات التعديلات محسوبة على أرقام موقع تاني.
  //    هنا الاستعلام مربوط بـ LOCATION_ID صراحةً.
  const locationGid = requireLocationId(env);
  const variants = [];
  let cursor  = null;
  let hasNext = true;
  let pages   = 0;
  let scanned = 0;
  let skippedNoLevel = 0;   // مخزّن في مواقع تانية بس — بيترجع للواجهة، مايتبلعش

  while (hasNext) {
    if (pages >= MAX_VARIANT_PAGES) {
      return { variants, truncated: true, scanned, pages, skippedNoLevel,
               dupBarcodes: collectDupBarcodes(variants) };
    }

    const gql = `
      query BulkIndex($cursor: String, $n: Int!, $loc: ID!) {
        productVariants(first: $n, after: $cursor) {
          nodes {
            id
            sku
            barcode
            title
            product { id status tags title vendor }
            last_audit_date: metafield(namespace: "custom", key: "last_stock_audit_date") { value }
            inventoryItem {
              id
              tracked
              inventoryLevel(locationId: $loc) {
                quantities(names: ["available", "committed", "on_hand"]) {
                  name quantity
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const data = await shopifyGQL(
      env, token, gql, { cursor, n: VARIANTS_PER_PAGE, loc: locationGid }, 'getBulkIndex'
    );

    const { nodes, pageInfo } = data.data.productVariants;
    pages++;
    scanned += nodes.length;

    for (const v of nodes) {
      if (v.product?.status !== 'ACTIVE')                    continue;
      if (!v.sku?.trim())                                    continue;
      if (!v.inventoryItem?.tracked)                         continue;
      if ((v.product?.tags || []).includes('Suspended'))      continue;

      // مش مخزّن في الموقع ده خالص → الكتابة عليه هترجع ITEM_NOT_STOCKED_AT_LOCATION.
      // بيتشال من الفهرس وبيتعدّ، عشان العدد يبان للموظف بدل ما يختفي في صمت.
      if (!v.inventoryItem.inventoryLevel) { skippedNoLevel++; continue; }

      const levels = v.inventoryItem.inventoryLevel.quantities || [];
      const getQty = name => {
        const found = levels.find(l => l.name === name);
        return found !== undefined ? found.quantity : null;
      };

      variants.push({
        variantId:       v.id,
        productId:       v.product.id,
        inventoryItemId: v.inventoryItem.id,
        sku:             v.sku.trim(),
        barcode:         (v.barcode || '').trim() || null,
        variantTitle:    v.title || '',
        productTitle:    v.product.title || '',
        vendor:          v.product.vendor || '',
        available:       getQty('available'),
        committed:       getQty('committed'),
        onHand:          getQty('on_hand'),
        lastAuditDate:   v.last_audit_date?.value || null,
      });
    }

    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  return { variants, truncated: false, scanned, pages, skippedNoLevel,
           dupBarcodes: collectDupBarcodes(variants) };
}

// باركود بيتكرر على أكتر من متغيّر → اسمه + الـ SKUs بتاعته، عشان الواجهة
// تعرض للموظف الاختيارين بدل ما تخمّن.
function collectDupBarcodes(variants) {
  const seen = new Map();
  for (const v of variants) {
    if (!v.barcode) continue;
    if (!seen.has(v.barcode)) seen.set(v.barcode, []);
    seen.get(v.barcode).push({ variantId: v.variantId, sku: v.sku, productTitle: v.productTitle });
  }
  const dups = {};
  for (const [bc, list] of seen) if (list.length > 1) dups[bc] = list;
  return dups;
}

// ─── §BULK::getShelfBreakdown — القطع المغلَّفة مقابل اللي لسه على الرف ───
//
// 🔴 التوأم المقصود لـ `getUnfulfilledOrders` فوق — **نفس المنطق بالحرف**
//    (نفس الاستعلام · نفس استبعاد الملغي والمرتجع · نفس قاعدة S1/S2)،
//    والفرق الوحيد إنه بيشتغل على **المنتج كله مرة واحدة** ويرجّع مجاميع
//    رقمية لكل متغيّر بدل قايمة أوردرات لمتغيّر واحد.
//
// ليه منتج مش متغيّر: المنتج الواحد فيه ٨ مقاسات، والاستعلام أصلاً بيفلتر بـ
// `product_id` — فاستدعاؤه لكل مقاس = ٨ نداءات لنفس البيانات.
//
// ⚠️ **أي تعديل على منطق التغليف لازم يتعمل في الدالتين مع بعض.** اختلافهم
//    معناه إن نفس الصنف يدّي «متوقع» مختلف في تاب الجرد وفي التاب الجماعي —
//    والموظف مش هيشوف غير رقمين مش متفقين بلا أي رسالة.
async function getShelfBreakdown(env, token, productId) {
  const productIdNumeric = productId.split('/').pop();
  const perVariant = new Map();   // variantId → { packed, unpacked, orders }
  let cursor  = null;
  let hasNext = true;

  const bump = (variantId, field, qty) => {
    if (!perVariant.has(variantId)) perVariant.set(variantId, { packed: 0, unpacked: 0, orders: 0 });
    const rec = perVariant.get(variantId);
    rec[field] += qty;
    return rec;
  };

  while (hasNext) {
    const gql = `
      query ShelfBreakdown($q: String!, $after: String) {
        orders(first: 50, query: $q, after: $after, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id cancelledAt
            status_2_r_e: metafield(namespace: "custom", key: "status_2_r_e") { value }
            s1_packed_by: metafield(namespace: "custom", key: "s1_packed_by") { value }
            s2_packed_by: metafield(namespace: "custom", key: "s2_packed_by") { value }
            lineItems(first: 20) {
              nodes {
                id
                unfulfilledQuantity
                fulfillableQuantity
                variant { id }
              }
            }
            returns(first: 3) {
              nodes {
                id status
                returnLineItems(first: 10) {
                  nodes {
                    ... on ReturnLineItem {
                      quantity
                      fulfillmentLineItem { lineItem { id } }
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const data = await shopifyGQL(env, token, gql, {
      q: `product_id:${productIdNumeric} fulfillment_status:unfulfilled`,
      after: cursor,
    }, 'getShelfBreakdown');
    const { nodes, pageInfo } = data.data.orders;

    for (const order of nodes) {
      if (order.cancelledAt) continue;

      const status2re  = order.status_2_r_e?.value || null;
      const orderStage = S2_VALUES.includes(status2re) ? 'S2' : 'S1';
      const packedBy   = orderStage === 'S2'
        ? (order.s2_packed_by?.value || null)
        : (order.s1_packed_by?.value || null);

      const returnedIds = new Set();
      for (const ret of (order.returns?.nodes || [])) {
        for (const rli of (ret.returnLineItems?.nodes || [])) {
          const li = rli.fulfillmentLineItem?.lineItem;
          if (li?.id && (rli.quantity || 0) > 0) returnedIds.add(li.id);
        }
      }

      const touched = new Set();
      for (const li of (order.lineItems?.nodes || [])) {
        const vId = li.variant?.id;
        if (!vId)                   continue;
        if (returnedIds.has(li.id)) continue;
        const qty = orderStage === 'S2' ? li.fulfillableQuantity : li.unfulfilledQuantity;
        if (!(qty > 0))             continue;

        bump(vId, packedBy ? 'packed' : 'unpacked', qty);
        touched.add(vId);
      }
      for (const vId of touched) bump(vId, 'orders', 1);
    }

    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  return perVariant;
}

// ─── §BULK::getLiveQuantities — الأرصدة في لحظة المقارنة، مش لحظة الفهرس ───
//
// 🔴 السبب اللي البند ده اتكتب عشانه: فهرس الجلسة بيتحمّل **قبل** العدّ، وبين
//    تحميله والضغط على «قارن» بيعدّي وقت طويل (جلسة مسح كاملة). أي بيعة أو
//    شحنة في الوقت ده بتخلّي «المتوقع» المعروض على الشاشة رقم قديم.
//    الكتابة نفسها محميّة بالـ CAS، فالخطر مش على المخزون — الخطر إن **الشاشة
//    تقول رقم والحقيقة رقم تاني**، والموظف ياخد قرار على رقم غلط.
//
// ⚠️ وبيقفل كمان عيب أدق: قبل كده الأرصدة كانت من لحظة الفهرس والمغلَّف من
//    لحظة المراجعة — يعني `available + committed − المغلَّف` بتتجمّع من
//    وقتين مختلفين ومش متسقة مع نفسها. دلوقتي الاتنين من نفس النداء.
async function getLiveQuantities(env, token, variantIds) {
  const locationGid = requireLocationId(env);
  const out = new Map();
  if (!variantIds.length) return out;

  const gql = `
    query LiveQuantities($ids: [ID!]!, $loc: ID!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          inventoryItem {
            id
            tracked
            inventoryLevel(locationId: $loc) {
              quantities(names: ["available", "committed", "on_hand"]) {
                name quantity
              }
            }
          }
        }
      }
    }
  `;
  const data = await shopifyGQL(env, token, gql, { ids: variantIds, loc: locationGid }, 'getLiveQuantities');

  for (const node of (data.data?.nodes || [])) {
    // ⚠️ `nodes` بترجّع null للـ ID اللي مالوش مورد — الصنف اتشال أو اتأرشف.
    //    بيتسجّل غياب، ومابيتحولش لصفر.
    if (!node?.id) continue;
    const level  = node.inventoryItem?.inventoryLevel;
    const levels = level?.quantities || [];
    const getQty = name => {
      const f = levels.find(l => l.name === name);
      return f !== undefined ? f.quantity : null;
    };
    out.set(node.id, {
      inventoryItemId: node.inventoryItem?.id || null,
      tracked:   !!node.inventoryItem?.tracked,
      hasLevel:  !!level,
      available: getQty('available'),
      committed: getQty('committed'),
      onHand:    getQty('on_hand'),
    });
  }
  return out;
}

// ─── §BULK::setInventoryAbsolute — الكتابة المطلقة بـ compare-and-swap ───
// ⚠️ الفعل ده **مالوش رجعة** — أي تحقق ممكن يتعمل بيتعمل قبله (Step 5A ⑩①).
// الفحوصات التلاتة (Step 5A ②): top-level → userErrors → تأكيد الـ payload.
async function setInventoryAbsolute(env, token, inventoryItemId, quantity, changeFromQuantity) {
  const locationId   = requireLocationId(env);
  const now          = new Date().toISOString();
  const referenceUri = `gid://Stock-Audit-Tool/BulkStockCount/${now}`;

  const gql = `
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message code }
        inventoryAdjustmentGroup {
          createdAt reason
          changes { name delta }
        }
      }
    }
  `;
  const data = await shopifyGQL(env, token, gql, {
    input: {
      reason:               BULK_ADJUST_REASON,
      name:                 'available',
      referenceDocumentUri: referenceUri,
      quantities: [{
        inventoryItemId,
        locationId,
        quantity,
        // 🔴 القلب: لو الرصيد الحالي على شوبيفاي مش مطابق للي الموظف عدّ عليه،
        //    الميوتيشن بترفض بـ CHANGE_FROM_QUANTITY_STALE و**مفيش أي كتابة**.
        //    تمرير null هنا كان هيلغي الحماية بالكامل.
        changeFromQuantity,
      }],
    },
  }, 'inventorySetQuantities');

  const result     = data.data?.inventorySetQuantities;
  const userErrors = result?.userErrors || [];
  if (userErrors.length > 0) {
    const stale = userErrors.some(e => e.code === 'CHANGE_FROM_QUANTITY_STALE');
    const msg   = userErrors.map(e => e.message).join(' | ');
    const err   = new Error(stale
      ? `الرصيد على شوبيفاي اتغيّر بعد ما عدّيت الصنف ده (بيع أو شحن) — `
        + `**مفيش أي تعديل اتعمل عليه**، أعد عدّه لوحده من تاب الجرد`
      : `inventorySetQuantities: ${msg}`);
    err.stale = stale;
    throw err;
  }
  // ③ `userErrors: []` معناها «مفيش اعتراض»، مش «اتنفّذت»
  const group = result?.inventoryAdjustmentGroup;
  if (!group?.changes?.length) {
    throw new Error('inventorySetQuantities: شوبيفاي ما أكدتش تعديل الكمية');
  }
  return group;
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // 🔴 حارس السر الغايب — قبل فحص الـ auth (Step 8)
    // السر الناقص لازم يدّي رسالة باسمه، مش 401 غامضة على كل نداء.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim()) {
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);
    }

    const authHeader = request.headers.get('Authorization') || '';
    const secret     = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!secret || secret !== env.WORKER_SECRET) {
      return json({ error: 'Unauthorized' }, 401, request);
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {

      // ─── §AUTH ────────────────────────────────────────────

      if (action === 'check_employee') {
        const username = url.searchParams.get('username') || '';
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        if (!/^\d{4}$/.test(pin)) return json({ ok: false, error: 'PIN يجب أن يكون 4 أرقام' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        await writeLog(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username') || '';
        if (username) {
          await writeLog(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }

      // ─── §DIAG — فحص ذاتي + النسخة ─────────────────────────

      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      }

      if (action === 'diag') {
        // ⚠️ ممنوع يعرض قيمة أي سر — الأسماء والأطوال بس.
        // الشكل المعتمد للجديد: مصفوفة [{ ok, label, detail }] بـ ok صريحة.
        const checks = [];
        const push = (ok, label, detail) => checks.push({ ok, label, detail: String(detail) });

        // ① المتغيّرات — الطول بيكشف المسافة المخفية في الاسم أو القيمة
        const envNames = ['WORKER_SECRET', 'CLIENT_ID', 'CLIENT_SECRET', 'SHOP_DOMAIN', 'LOCATION_ID'];
        for (const n of envNames) {
          const v = env[n];
          const present = typeof v === 'string' && v.trim().length > 0;
          push(present, `env: ${n}`, present ? `موجود — الطول ${v.length}` : 'ناقص');
        }
        push(
          Object.keys(env).length > 0,
          'env: كل المفاتيح',
          Object.keys(env).sort().join(' · ')
        );

        // ② D1
        try {
          const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?')
            .bind(TOOL_NAME).first();
          push(true, 'D1: ecommoda-dev-logs', `متصلة — ${row?.n ?? 0} صف لهذه الأداة`);
        } catch (e) {
          push(false, 'D1: ecommoda-dev-logs', `FAILED: ${e.message}`);
        }

        // ③ OAuth + صلاحيات التطبيق
        let diagToken = null;
        try {
          diagToken = await getAccessToken(env);
          push(true, 'شوبيفاي: OAuth', 'اتحصل على access_token');
        } catch (e) {
          push(false, 'شوبيفاي: OAuth', `FAILED: ${e.message}`);
        }

        if (diagToken) {
          try {
            const d = await shopifyGQL(env, diagToken,
              `{ currentAppInstallation { accessScopes { handle } } }`, {}, 'diag:scopes');
            const scopes = (d.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
            const needed = ['read_products', 'write_inventory', 'read_orders'];
            const missing = needed.filter(s => !scopes.includes(s));
            push(missing.length === 0, 'شوبيفاي: الصلاحيات',
              missing.length ? `ناقصة: ${missing.join(' · ')} — المتاح: ${scopes.join(' · ')}`
                             : scopes.join(' · '));
          } catch (e) {
            push(false, 'شوبيفاي: الصلاحيات', `FAILED: ${e.message}`);
          }

          // ④ الـ LOCATION_ID بيتحل لموقع حقيقي؟
          try {
            const gid = requireLocationId(env);
            const d = await shopifyGQL(env, diagToken,
              `query($id: ID!) { location(id: $id) { id name isActive } }`, { id: gid }, 'diag:location');
            const loc = d.data?.location;
            push(!!loc, 'شوبيفاي: LOCATION_ID',
              loc ? `${loc.name} — ${loc.isActive ? 'نشط' : 'غير نشط'}`
                  : 'الـ ID مش بيتحل لموقع حقيقي — الميوتيشن هترمي userError');
          } catch (e) {
            push(false, 'شوبيفاي: LOCATION_ID', `FAILED: ${e.message}`);
          }
        }

        // ⑤ تكلفة الاستعلام — الاقتراب من السقف مابيبانش غير بانفجار دفعة
        push(true, 'شوبيفاي: throttleStatus',
          lastThrottleStatus
            ? `متاح ${lastThrottleStatus.currentlyAvailable} من ${lastThrottleStatus.maximumAvailable} · استرجاع ${lastThrottleStatus.restoreRate}/ث`
            : 'لسه مفيش استعلام في الطلب ده');

        // ⑥ الساعة — بيكشف عيلة «كل الأوقات غلط بساعة» فورًا بدل ما تتكتشف من الشاشة
        const nowUtc = new Date();
        push(true, 'التوقيت: Africa/Cairo',
          `القاهرة ${cairoDate(nowUtc)} — UTC ${nowUtc.toISOString().slice(0, 10)} (محسوب بـ Intl، مفيش إزاحة ثابتة)`);

        // ⑦ الـ Origin
        const origin = request.headers.get('Origin') || '(بدون Origin)';
        push(ALLOWED_ORIGINS.includes(origin) || origin === '(بدون Origin)',
          'CORS: Origin', `${origin} — المسموح: ${ALLOWED_ORIGINS.join(' · ')}`);

        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME, checks }, 200, request);
      }

      // ─── §LOG-ENDPOINTS ───────────────────────────────────

      if (action === 'get_logs') {
        const p = logParamsFrom(url, TOOL_NAME);
        // 🔴 parseInt('abc') → NaN · Math.min(NaN,100) → NaN → بيوصل لـ D1 كـ bind
        //    ويرجّع خطأ غامض. الحراسة إلزامية، مش تجميل.
        const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
        const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
        const limit  = Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

        const entries = await getLogs(env.DB, {
          ...p, limit, offset,
          sortBy:  url.searchParams.get('sortBy'),
          sortDir: url.searchParams.get('sortDir'),
        });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, logParamsFrom(url, TOOL_NAME));
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const p = logParamsFrom(url, TOOL_NAME);
        const [entries, total] = await Promise.all([
          getLogsExport(env.DB, p),
          getLogsCount(env.DB, p),          // العدّ الحقيقي جنب الصفوف
        ]);
        return json({
          ok: true, entries,
          cap: LOG_EXPORT_MAX, total,
          truncated: total > LOG_EXPORT_MAX,
        }, 200, request);
      }

      // ─── §AUDIT — Shopify endpoints (need token) ──────────

      const token = await getAccessToken(env);

      if (action === 'list_skus') {
        const search   = url.searchParams.get('search') || '';
        const variants = await listSkus(env, token, search);
        return json({ ok: true, variants }, 200, request);
      }

      if (action === 'lookup_barcode') {
        const barcode = url.searchParams.get('barcode') || '';
        if (!barcode) return json({ error: 'Missing barcode' }, 400, request);
        const variant = await lookupBarcode(env, token, barcode);
        return json({ ok: true, variant }, 200, request);
      }

      if (action === 'get_details') {
        const variantId = url.searchParams.get('variantId') || '';
        const productId = url.searchParams.get('productId') || '';
        if (!variantId || !productId) {
          return json({ error: 'Missing variantId or productId' }, 400, request);
        }
        const orders = await getUnfulfilledOrders(env, token, variantId, productId);
        return json({ ok: true, orders }, 200, request);
      }

      if (action === 'get_audit_date') {
        const variantId = url.searchParams.get('variantId') || '';
        if (!variantId) return json({ error: 'Missing variantId' }, 400, request);
        const meta = await getAuditMetafields(env, token, variantId);
        return json({ ok: true, ...meta }, 200, request);
      }

      // ─── §AUDIT — Priority Queue ──────────────────────────

      if (action === 'get_audit_priorities') {
        const { variants, truncated, scanned, pages } = await getAllVariantsForAudit(env, token);
        return json({
          ok: true, variants, count: variants.length,
          truncated, scanned, pages,
          cap: MAX_VARIANT_PAGES * VARIANTS_PER_PAGE,
        }, 200, request);
      }

      // ─── §BULK — الجرد الجماعي ───────────────────────────
      //
      // تلات endpoints بيتنادوا بالترتيب ده من التاب الجماعي:
      //   ① get_bulk_index  — فهرس الباركود مرة واحدة في أول الجلسة (قراءة)
      //   ② bulk_compare    — الأرصدة الحيّة + المغلَّف في نفس اللحظة (قراءة)
      //   ③ bulk_adjust     — الكتابة الجماعية (POST)

      if (action === 'get_bulk_index') {
        const { variants, truncated, scanned, pages, skippedNoLevel, dupBarcodes } = await getBulkIndex(env, token);
        return json({
          ok: true, variants, count: variants.length,
          truncated, scanned, pages, skippedNoLevel,
          cap: MAX_VARIANT_PAGES * VARIANTS_PER_PAGE,
          dupBarcodes,
          // مصدر واحد للسقوف — الواجهة بتقراها ومابتكتبش أرقامها عندها (⑪)
          chunkHint:        BULK_CHUNK,
          maxBatch:         BULK_MAX_BATCH,
          compareChunkHint: BULK_COMPARE_CHUNK,
          compareMaxBatch:  BULK_COMPARE_MAX_BATCH,
        }, 200, request);
      }

      // ── ② المقارنة — الأرصدة الحيّة + المغلَّف في **نفس اللحظة** ──
      //
      // العقد: **نتيجة واحدة لكل عنصر في `items`، بنفس الترتيب**، في كل الفروع.
      // ⚠️ الواجهة بتطابق بالفهرس وبتتأكد من `variantId` كمان — أي `continue`
      //    من غير `push` هيزحلق كل اللي بعده.
      // ⛔ فشل الاستعلام **مايتحوّلش لصفر** — بيرجع `ok:false` ورسالة، والصنف
      //    بيفضل غير قابل للتنفيذ لحد ما نعرف رقمه الحقيقي.
      //
      // ترتيب مقصود: الأرصدة الأول (استعلام واحد رخيص للكل)، وبعدها المغلَّف
      // **بس** للمتغيّرات اللي عليها حجز — الصنف بلا حجز مافيش قطع منه متغلّفة
      // أصلاً، فاستعلام أوردراته إهدار خالص.
      if (action === 'bulk_compare') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body  = await request.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];

        if (!items.length) return json({ ok: false, error: 'items مطلوبة' }, 400, request);
        if (items.length > BULK_COMPARE_MAX_BATCH) {
          return json({
            ok: false,
            error: `الدفعة أكبر من الحد (${items.length} من ${BULK_COMPARE_MAX_BATCH}) — قسّمها`,
          }, 400, request);
        }

        const at = new Date().toISOString();   // لحظة المقارنة — بترجع للواجهة

        // ① الأرصدة الحيّة — استعلام واحد لكل المتغيّرات المطلوبة
        const wantIds = [...new Set(items.map(it => String(it?.variantId || '')).filter(Boolean))];
        let qtys = new Map(), qtyError = null;
        try {
          qtys = await getLiveQuantities(env, token, wantIds);
        } catch (e) { qtyError = e.message; }

        // ② المغلَّف — للمتغيّرات اللي عليها حجز بس، ومجمّعة بالمنتج
        //    (منتج فيه ٨ مقاسات = استعلام واحد مش تمانية)
        const needPacked = new Map();   // productId → true
        for (const it of items) {
          const vid = String(it?.variantId || '');
          const pid = String(it?.productId || '');
          const q   = qtys.get(vid);
          if (!vid || !pid || !q) continue;
          if ((q.committed ?? 0) > 0) needPacked.set(pid, true);
        }

        const breakdowns = new Map();   // productId → { map } | { error }
        for (const pid of needPacked.keys()) {
          try {
            breakdowns.set(pid, { map: await getShelfBreakdown(env, token, pid) });
          } catch (e) {
            breakdowns.set(pid, { error: e.message });
          }
        }

        const results = items.map(it => {
          const variantId = String(it?.variantId || '');
          const productId = String(it?.productId || '');
          const base = { variantId, productId, at };

          if (!variantId || !productId)
            return { ...base, ok: false, error: 'variantId أو productId ناقص' };
          if (qtyError)
            return { ...base, ok: false, error: `تعذّر قراءة الأرصدة: ${qtyError}` };

          const q = qtys.get(variantId);
          if (!q)
            return { ...base, ok: false, error: 'الصنف مش موجود على شوبيفاي دلوقتي — اتشال أو اتأرشف' };
          if (!q.tracked)
            return { ...base, ok: false, error: 'المخزون مش متتبّع للصنف ده' };
          if (!q.hasLevel)
            return { ...base, ok: false, error: 'الصنف مش مخزّن في الموقع ده' };

          // مافيش حجز → مافيش قطع متغلّفة، من غير أي استعلام
          if ((q.committed ?? 0) <= 0) {
            return { ...base, ok: true, inventoryItemId: q.inventoryItemId,
                     available: q.available, committed: q.committed, onHand: q.onHand,
                     packed: 0, unpacked: 0, orders: 0 };
          }

          const b = breakdowns.get(productId);
          if (!b || b.error)
            return { ...base, ok: false, error: b?.error || 'تعذّر استعلام الأوردرات المعلّقة' };

          const rec = b.map.get(variantId) || { packed: 0, unpacked: 0, orders: 0 };
          return { ...base, ok: true, inventoryItemId: q.inventoryItemId,
                   available: q.available, committed: q.committed, onHand: q.onHand,
                   packed: rec.packed, unpacked: rec.unpacked, orders: rec.orders };
        });

        return json({ ok: true, at, results }, 200, request);
      }

      // ── ③ الكتابة الجماعية ──
      //
      // العقد: **نتيجة واحدة لكل عنصر في `items`، بنفس الترتيب**، في كل الفروع
      // (worker-builder Step 5A ⑬). الواجهة بتطابق بالفهرس + تأكيد `variantId`.
      //
      // 🔴 قاعدة عدم الضياع (⑭): لكل عنصر في الدفعة **صف واحد بالظبط** في D1 —
      //    `adjustment` لو فيه فرق، و`ok` لو العدّ مطابق. مفيش مسار بيتخطّى
      //    عنصر في صمت.
      //    والتحقق كله بيتم **قبل** أول كتابة على الدفعة كلها: أي عنصر مش
      //    مظبوط بيرفض النداء بـ 400 و**مفيش أي صنف بيتلمس** — فالإجابة على
      //    «الأداة حاولت ولا لأ؟» تبقى صريحة: لأ، ولا صنف واحد.
      //    (عشان كده مفيش `rejected` هنا — مفيش مسار بيوقف بعد ما الدفعة تبدأ.)
      if (action === 'bulk_adjust') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));

        const employee = body.employee || '';
        const batchId  = String(body.batchId || '').slice(0, 48) || null;
        const items    = Array.isArray(body.items) ? body.items : [];

        if (!items.length) return json({ ok: false, error: 'items مطلوبة' }, 400, request);
        if (items.length > BULK_MAX_BATCH) {
          return json({
            ok: false,
            error: `الدفعة أكبر من الحد (${items.length} من ${BULK_MAX_BATCH}) — قسّمها`,
          }, 400, request);
        }

        // ⑩① كل تحقق ممكن يتعمل — قبل أول فعل لا رجعة فيه
        // ⑫ حارس التكرار **بالكيان** (الصنف)، مش بالمدخل. الواجهة بتجمّع
        //    المسحات في Map مفتاحها `variantId` فالتكرار مستحيل منها — الحارس
        //    ده ضد نداء مبني بالغلط، وبيرفض الدفعة كلها قبل أي كتابة.
        const seenVariants = new Set();
        const prepared = [];
        for (let i = 0; i < items.length; i++) {
          const it  = items[i] || {};
          const pos = i + 1;

          const variantId       = String(it.variantId       || '');
          const inventoryItemId = String(it.inventoryItemId || '');
          if (!variantId || !inventoryItemId) {
            return json({ ok: false, error: `العنصر رقم ${pos}: variantId أو inventoryItemId ناقص`, index: i }, 400, request);
          }
          if (seenVariants.has(variantId)) {
            return json({ ok: false, error: `العنصر رقم ${pos}: الصنف ${it.sku || variantId} مكرر في نفس الدفعة`, index: i }, 400, request);
          }
          seenVariants.add(variantId);

          const counted         = parseInt(it.counted,         10);
          const expected        = parseInt(it.expected,        10);
          const delta           = parseInt(it.delta,           10);
          const availableAtScan = parseInt(it.availableAtScan, 10);
          const committedAtScan = parseInt(it.committedAtScan ?? 0, 10);
          const packedAtScan    = parseInt(it.packedAtScan    ?? 0, 10);

          if (![counted, expected, delta, availableAtScan].every(Number.isFinite)) {
            return json({ ok: false, error: `العنصر رقم ${pos}: أرقام العدّ مش صحيحة`, index: i }, 400, request);
          }
          if (counted < 0) {
            return json({ ok: false, error: `العنصر رقم ${pos}: العدّ مايكونش بالسالب`, index: i }, 400, request);
          }
          // الفرق لازم يطلع من نفس الرقمين المعروضين على الشاشة — اختلافه
          // معناه إن الصفحة والنداء مش على نفس اللقطة.
          if (counted - expected !== delta) {
            return json({
              ok: false,
              error: `العنصر رقم ${pos}: الفرق (${delta}) مش مطابق للعدّ (${counted}) ناقص المتوقع (${expected}) — أعد حساب المقارنة`,
              index: i,
            }, 400, request);
          }

          prepared.push({
            variantId, inventoryItemId,
            sku:          it.sku          || null,
            productTitle: it.productTitle || null,
            notes:        (it.notes || '').toString().slice(0, 400),
            counted, expected, delta,
            availableAtScan,
            committedAtScan: Number.isFinite(committedAtScan) ? committedAtScan : 0,
            packedAtScan:    Number.isFinite(packedAtScan)    ? packedAtScan    : 0,
          });
        }

        requireLocationId(env);   // بيرمي قبل أي كتابة لو ناقص

        const results = [];
        const counts  = { success: 0, warning: 0, error: 0 };

        for (const p of prepared) {
          // ⑤ الأكشنز بتتملي أول بأول — لو رمى استثناء في النص، اللي حصل بيفضل مسجّل
          const actions  = [];
          const warnings = [];
          let status       = 'success';
          let errorMsg     = null;
          let stale        = false;
          let auditDate    = null;
          let newAvailable = null;

          if (p.delta !== 0) {
            try {
              const target = p.availableAtScan + p.delta;
              await setInventoryAbsolute(env, token, p.inventoryItemId, target, p.availableAtScan);
              newAvailable = target;
              actions.push(`inventorySetQuantities: available ${p.availableAtScan} → ${target}`);
            } catch (e) {
              status   = 'error';
              errorMsg = e.message;
              stale    = !!e.stale;
            }
          }

          // ⑩② الفشل **بعد** الفعل الأساسي = warning مش error، ومعاه إجراء الإصلاح
          if (status !== 'error') {
            try {
              const meta = await setAuditMetafields(env, token, p.variantId, employee, p.notes);
              auditDate = meta.auditDate;
              actions.push(`metafieldsSet×${meta.written}`);
            } catch (e) {
              if (p.delta !== 0) {
                status = 'warning';
                warnings.push(
                  `الكمية اتعدّلت فعلاً على شوبيفاي، لكن تاريخ الجرد ما اتكتبش (${e.message}) — `
                  + `سجّل الجرد يدويًا على الصنف ده، ومتعيدش التعديل`
                );
              } else {
                // مفيش فعل أساسي تاني في المسار ده — فده فشل كامل مش جزئي
                status   = 'error';
                errorMsg = e.message;
              }
            }
          }

          // ⑦ فشل D1 يبان — العملية حصلت بس مفيش سجل
          let logged = true, logError = null;
          try {
            await writeLog(env.DB, {
              tool:         TOOL_NAME,
              type:         p.delta !== 0 ? LOG_TYPE_ADJUSTMENT : LOG_TYPE_OK,
              timestamp:    auditDate || new Date().toISOString(),
              employee:     employee     || null,
              sku:          p.sku,
              productTitle: p.productTitle,
              delta:        p.delta,
              valueBefore:  p.expected,
              valueAfter:   p.counted,
              notes:        p.notes || null,
              // ⚠️ عقد مفاتيح `extra` — الواجهة بتقرا `result` بس (عمود النتيجة
              //    في تاب السجل). الباقي للتشخيص: `mode` بيفرّق الجرد الجماعي
              //    عن الفردي، و`batchId` بيلمّ جلسة المسح الواحدة في السجل.
              extra: {
                result: status, actions, warnings, error: errorMsg,
                mode: 'bulk', batchId, stale,
                counted:   p.counted,
                expected:  p.expected,
                available: p.availableAtScan,
                committed: p.committedAtScan,
                packed:    p.packedAtScan,
              },
            });
          } catch (e) { logged = false; logError = e.message; }

          counts[status]++;
          results.push({
            variantId: p.variantId,
            sku:       p.sku,
            status, actions, warnings, logged, logError,
            error: errorMsg, stale,
            auditDate, newAvailable,
            delta: p.delta, counted: p.counted, expected: p.expected,
          });
        }

        // ⚠️ `ok: true` دايمًا هنا — الدفعة الجزئية مش فشل. نتيجة كل صنف في
        //    `results`، والواجهة بتعرضها صف بصف. (`ok:false` محجوزة لرفض
        //    الدفعة كلها قبل أي كتابة — فوق.)
        return json({ ok: true, batchId, results, counts }, 200, request);
      }

      // ─── §AUDIT — Write endpoints ─────────────────────────
      //
      // العقد الموحّد للنداءين دول (worker-builder Step 5A ④ · constants §12):
      //   { ok, status, actions[], warnings[], logged, ... }
      //   status: success = الفعل تم واتأكد
      //           warning = الفعل الأساسي تم، وخطوة تكميلية فشلت أو ما اتأكدتش
      //           error   = الفعل الأساسي نفسه فشل — مفيش أي أثر على شوبيفاي
      // ⚠️ `warning` ممنوع تتحسب نجاح، و`error` هنا معناها إن النداء وصل
      //    لشوبيفاي واترفض — فبيتسجّل في D1 برضه بـ extra.result='error'.

      if (action === 'adjust_inventory') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));

        const inventoryItemId = body.inventoryItemId || '';
        const variantId       = body.variantId       || '';
        const employee        = body.employee        || '';
        const notes           = body.notes           || '';
        const sku             = body.sku             || '';
        const productTitle    = body.productTitle    || '';

        // ⑩① كل تحقق ممكن يتعمل — يتعمل **قبل** أول فعل لا رجعة فيه
        if (!inventoryItemId || !variantId) {
          return json({ error: 'Missing inventoryItemId or variantId' }, 400, request);
        }
        const deltaInt = parseInt(body.delta, 10);
        if (!Number.isFinite(deltaInt) || deltaInt === 0) {
          return json({ error: 'delta must be a non-zero integer' }, 400, request);
        }
        const shelfRaw    = parseInt(body.shelfBefore ?? 0, 10);
        const shelfBefore = Number.isFinite(shelfRaw) ? shelfRaw : 0;
        requireLocationId(env);          // بيرمي قبل أي كتابة لو ناقص

        // ⑤ الأكشنز بتتملي أول بأول — لو رمى استثناء في النص، اللي حصل بيفضل مسجّل
        const actions  = [];
        const warnings = [];
        let status     = 'success';
        let errorMsg   = null;
        let auditDate  = null;
        let adjustment = null;

        try {
          adjustment = await adjustInventory(env, token, inventoryItemId, deltaInt);
          actions.push(`inventoryAdjustQuantities: ${deltaInt > 0 ? '+' : ''}${deltaInt}`);
        } catch (e) {
          status   = 'error';
          errorMsg = e.message;
        }

        // ⑩② الفشل **بعد** الفعل الأساسي = warning مش error، ومعاه إجراء الإصلاح
        if (status !== 'error') {
          try {
            const meta = await setAuditMetafields(env, token, variantId, employee, notes);
            auditDate = meta.auditDate;
            actions.push(`metafieldsSet×${meta.written}`);
          } catch (e) {
            status = 'warning';
            warnings.push(
              `الكمية اتعدّلت فعلاً على شوبيفاي، لكن تاريخ الجرد ما اتكتبش (${e.message}) — ` +
              `سجّل الجرد يدويًا على الصنف ده، ومتعيدش التعديل`
            );
          }
        }

        // ⑦ فشل D1 يبان — العملية حصلت بس مفيش سجل
        let logged = true, logError = null;
        try {
          await writeLog(env.DB, {
            tool:         TOOL_NAME,
            type:         LOG_TYPE_ADJUSTMENT,
            timestamp:    auditDate || new Date().toISOString(),
            employee:     employee     || null,
            sku:          sku          || null,
            productTitle: productTitle || null,
            delta:        deltaInt,
            valueBefore:  shelfBefore,
            valueAfter:   shelfBefore + deltaInt,
            notes:        notes        || null,
            extra:        { result: status, actions, warnings, error: errorMsg },
          });
        } catch (e) { logged = false; logError = e.message; }

        return json({
          ok: status !== 'error',
          status, actions, warnings, logged, logError,
          error: errorMsg,
          adjustment, auditDate,
        }, 200, request);
      }

      if (action === 'set_audit_date') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));

        const variantId    = body.variantId    || '';
        const employee     = body.employee     || '';
        const sku          = body.sku          || '';
        const productTitle = body.productTitle || '';
        const shelfRaw     = parseInt(body.shelfQty ?? 0, 10);
        const shelfQty     = Number.isFinite(shelfRaw) ? shelfRaw : 0;
        const notes        = 'تم المراجعة والتأكد من الجرد مظبوط في المخزن';

        if (!variantId) return json({ error: 'Missing variantId' }, 400, request);

        const actions  = [];
        const warnings = [];
        let status    = 'success';
        let errorMsg  = null;
        let auditDate = null;

        try {
          const meta = await setAuditMetafields(env, token, variantId, employee, notes);
          auditDate = meta.auditDate;
          actions.push(`metafieldsSet×${meta.written}`);
        } catch (e) {
          status   = 'error';
          errorMsg = e.message;
        }

        let logged = true, logError = null;
        try {
          await writeLog(env.DB, {
            tool:         TOOL_NAME,
            type:         LOG_TYPE_OK,
            timestamp:    auditDate || new Date().toISOString(),
            employee:     employee     || null,
            sku:          sku          || null,
            productTitle: productTitle || null,
            delta:        0,
            valueBefore:  shelfQty,
            valueAfter:   shelfQty,
            notes,
            extra:        { result: status, actions, warnings, error: errorMsg },
          });
        } catch (e) { logged = false; logError = e.message; }

        return json({
          ok: status !== 'error',
          status, actions, warnings, logged, logError,
          error: errorMsg,
          auditDate,
        }, 200, request);
      }

      return json({ error: 'Unknown action' }, 400, request);

    } catch (err) {
      return json({ ok: false, status: 'error', error: err.message }, 500, request);
    }
  },
};
