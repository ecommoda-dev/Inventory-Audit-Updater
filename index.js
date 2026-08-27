// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// inventory-audit-updater-worker — EcomModa v4.0.0
// Account: ecommoda-dev (762c353004e8472b20261fba273bfe8d)
// D1: DB → ecommoda-dev-logs
//
// CHANGELOG v4.0.0:
//   - listSkus / lookupBarcode: إضافة product.vendor للـ GraphQL query
//     * يُستخدم في الـ HTML الجديد لعرض اسم البراند بدل اسم المنتج الكامل
//     * حقل String قياسي على Product object — لا تغيير في أي منطق آخر
//
// CHANGELOG v3.1.0:
//   - getAllVariantsForAudit: إضافة inventoryItem.tracked + product.tags + product.title
//     * استثناء: Inventory not tracked (tracked === false) من Priority Queue
//     * استثناء: تاج Suspended من كل أماكن الأداة
//     * إضافة productTitle للـ response (للبحث في Priority Queue filters)
//   - listSkus: إضافة product.tags + فلتر Suspended client-side
//   - lookupBarcode: إضافة product.tags + فلتر Suspended
//
// CHANGELOG v3.0.0:
//   - إضافة endpoint جديد: get_audit_priorities
//     * يجلب كل productVariants من المتجر بدون collection filter
//     * يفلتر ACTIVE products فقط server-side
//     * يرجع: variantId, productId, sku, available, committed, onHand, lastAuditDate
//     * يدعم أداة أولويات الجرد الجديدة في الـ HTML
//
// CHANGELOG v2.5.0:
//   - تحديث منطق تحديد حالة التغليف بالكامل (s1/s2_packed_by)
//   - اكتشاف مرحلة الأوردر (S1/S2) عبر manual_status / status_2_r_e
//   - S2 Exchange Items: fulfillableQuantity > 0
//   - returnedIds: من returns.nodes[].returnLineItems
//   - CORS: Strict origins (write tool)
// ══════════════════════════════════════════════════════════════

const TOOL_NAME = 'inventory_audit';

const S2_VALUES = ['Confirmed + RETURN', 'Confirmed + EXCHANGE', 'Printed', 'Ready'];

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

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify
// EcomModa D1 Pattern v1.2.0
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
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

async function getLogs(db, {
  tool     = null,
  employee = null,
  type     = null,
  search   = null,
  limit    = 200,
  offset   = 0,
} = {}) {
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type)     { sql += ' AND type = ?';     b.push(type); }
  if (search) {
    sql += ' AND (sku LIKE ? OR product_title LIKE ? OR order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  b.push(Math.min(limit, 500), offset);

  return (await db.prepare(sql).bind(...b).all()).results;
}

// ══════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════

async function getAccessToken(env) {
  const res = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const res = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
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
  const data = await shopifyGQL(env, token, gql, { q: queryStr || null });
  if (data.errors) throw new Error(data.errors[0].message);

  // v3.1.0: استثناء منتجات تاج Suspended من نتائج البحث
  return data.data.productVariants.nodes.filter(
    v => !(v.product?.tags || []).includes('Suspended')
  );
}

// ── Lookup by barcode ─────────────────────────────────────────────────────────
// v4.0.0: إضافة product.vendor (اسم البراند)
// v3.1.0: إضافة product.tags + فلتر Suspended
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
  const data = await shopifyGQL(env, token, gql, { q: `barcode:${barcode}` });
  if (data.errors) throw new Error(data.errors[0].message);
  const nodes = data.data.productVariants.nodes;
  if (!nodes.length) return null;
  const variant = nodes[0];
  // v3.1.0: استثناء منتجات Suspended حتى لو تم مسح باركودها
  if ((variant.product?.tags || []).includes('Suspended')) return null;
  return variant;
}

// ── Get all variants for Priority Audit Queue — v3.1.0 ───────────────────────
// بدون collection filter — كل المنتجات من المتجر
// يستثني:
//   1. المنتجات غير ACTIVE
//   2. المنتجات بدون SKU
//   3. Inventory not tracked (inventoryItem.tracked === false)  ← v3.1.0
//   4. منتجات تاج Suspended                                    ← v3.1.0
async function getAllVariantsForAudit(env, token) {
  const allVariants = [];
  let cursor  = null;
  let hasNext = true;

  while (hasNext) {
    const gql = `
      query GetAllVariants($cursor: String) {
        productVariants(first: 250, after: $cursor) {
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

    const data = await shopifyGQL(env, token, gql, { cursor });
    if (data.errors) throw new Error(data.errors[0].message);

    const { nodes, pageInfo } = data.data.productVariants;

    for (const v of nodes) {
      // استثناء 1: غير ACTIVE
      if (v.product?.status !== 'ACTIVE') continue;
      // استثناء 2: بدون SKU
      if (!v.sku?.trim()) continue;
      // استثناء 3 (v3.1.0): Inventory not tracked
      if (!v.inventoryItem?.tracked) continue;
      // استثناء 4 (v3.1.0): تاج Suspended
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
        productTitle:  v.product.title || '',   // v3.1.0: للبحث في Priority Queue
        available:     getQty('available'),
        committed:     getQty('committed'),
        onHand:        getQty('on_hand'),
        lastAuditDate: v.last_audit_date?.value || null,
      });
    }

    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  return allVariants;
}

// ── Get unfulfilled orders — v2.5.0 ──────────────────────────────────────────
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
            id name createdAt tags cancelledAt
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
    });
    if (data.errors) throw new Error(data.errors[0].message);
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
  const data = await shopifyGQL(env, token, gql, { id: variantId });
  if (data.errors) throw new Error(data.errors[0].message);
  const v = data.data?.productVariant;
  return {
    auditDate:     v?.auditDate?.value     || null,
    auditEmployee: v?.auditEmployee?.value || null,
    auditNotes:    v?.auditNotes?.value    || null,
  };
}

// ── Set audit metafields ──────────────────────────────────────────────────────
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
  const data = await shopifyGQL(env, token, gql, { metafields });
  if (data.errors) throw new Error(data.errors[0].message);
  const userErrors = data.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) throw new Error(userErrors[0].message);
  return { auditDate: now };
}

// ── Adjust inventory ──────────────────────────────────────────────────────────
async function adjustInventory(env, token, inventoryItemId, delta) {
  const locationId   = `gid://shopify/Location/${env.LOCATION_ID}`;
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
      changes: [{ delta: parseInt(delta), inventoryItemId, locationId }],
    },
  });
  if (adjustData.errors) throw new Error(adjustData.errors[0].message);
  const userErrors = adjustData.data?.inventoryAdjustQuantities?.userErrors || [];
  if (userErrors.length > 0) throw new Error(userErrors[0].message);
  return adjustData.data.inventoryAdjustQuantities.inventoryAdjustmentGroup;
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
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

      // ─── §LOG-ENDPOINTS ───────────────────────────────────

      if (action === 'get_logs') {
        const entries = await getLogs(env.DB, {
          tool:     TOOL_NAME,
          employee: url.searchParams.get('employee') || null,
          type:     url.searchParams.get('type')     || null,
          search:   url.searchParams.get('search')   || null,
          limit:    parseInt(url.searchParams.get('limit')  || '200'),
          offset:   parseInt(url.searchParams.get('offset') || '0'),
        });
        return json({ ok: true, entries }, 200, request);
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
        const variants = await getAllVariantsForAudit(env, token);
        return json({ ok: true, variants, count: variants.length }, 200, request);
      }

      if (action === 'adjust_inventory') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));

        const inventoryItemId = body.inventoryItemId || '';
        const variantId       = body.variantId       || '';
        const delta           = body.delta;
        const employee        = body.employee         || '';
        const notes           = body.notes            || '';
        const sku             = body.sku              || '';
        const productTitle    = body.productTitle     || '';
        const shelfBefore     = parseInt(body.shelfBefore ?? 0);

        if (!inventoryItemId || !variantId) {
          return json({ error: 'Missing inventoryItemId or variantId' }, 400, request);
        }
        const deltaInt = parseInt(delta);
        if (isNaN(deltaInt) || deltaInt === 0) {
          return json({ error: 'delta must be non-zero integer' }, 400, request);
        }

        const [adjustResult, auditResult] = await Promise.all([
          adjustInventory(env, token, inventoryItemId, deltaInt),
          setAuditMetafields(env, token, variantId, employee, notes),
        ]);

        await writeLog(env.DB, {
          tool:         TOOL_NAME,
          type:         'adjustment',
          timestamp:    auditResult.auditDate,
          employee:     employee     || null,
          sku:          sku          || null,
          productTitle: productTitle || null,
          delta:        deltaInt,
          valueBefore:  shelfBefore,
          valueAfter:   shelfBefore + deltaInt,
          notes:        notes        || null,
        });

        return json({ ok: true, adjustment: adjustResult, auditDate: auditResult.auditDate }, 200, request);
      }

      if (action === 'set_audit_date') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const body = await request.json().catch(() => ({}));

        const variantId    = body.variantId    || '';
        const employee     = body.employee     || '';
        const sku          = body.sku          || '';
        const productTitle = body.productTitle || '';
        const shelfQty     = parseInt(body.shelfQty ?? 0);
        const notes        = 'تم المراجعة والتأكد من الجرد مظبوط في المخزن';

        if (!variantId) return json({ error: 'Missing variantId' }, 400, request);

        const result = await setAuditMetafields(env, token, variantId, employee, notes);

        await writeLog(env.DB, {
          tool:         TOOL_NAME,
          type:         'ok',
          timestamp:    result.auditDate,
          employee:     employee     || null,
          sku:          sku          || null,
          productTitle: productTitle || null,
          delta:        0,
          valueBefore:  shelfQty,
          valueAfter:   shelfQty,
          notes,
        });

        return json({ ok: true, ...result }, 200, request);
      }

      return json({ error: 'Unknown action' }, 400, request);

    } catch (err) {
      return json({ error: err.message }, 500, request);
    }
  },
};
