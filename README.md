<div dir="rtl" style="text-align: right;">

# Inventory Audit Updater

> 🗑️ **18-11-2026 — الواجهة المستقلة (`index.html`) اتحذفت** (قرار أحمد). الريبو بقى **Worker فقط**، والواجهة الوحيدة `Inventory-Audit-Updater.html` في `Warehouse-Operations-Center`. رابط GitHub Pages القديم بيدّي `404` **بلا إعادة توجيه**، ومفيش نقطة رجوع مستقلة. ⚠️ أي ذكر تحت لـ«الواجهة المستقلة» / `index.html` / «نقطة رجوع» بيوصف الوضع **قبل الحذف** (تاريخي) — وأي تعديل واجهة بيتعمل في الهب بس.

![version](https://img.shields.io/badge/version-v2.2.0-blue)

أداة داخلية لموظفي مخزن EcomModa لمراجعة أرصدة المخزون بالباركود/SKU،
تصحيح الفرق، وتسجيل تاريخ آخر جرد لكل صنف — مع قايمة أولويات جرد لكل المتجر،
و**جرد جماعي** لرفوف كاملة بالسكانر في جلسة واحدة.

- **الواجهة:** في الهب فقط (`Inventory-Audit-Updater.html`) — مفيش واجهة مستقلة
- **الـ Worker:** Cloudflare Workers (`index.js` — v6.1.1) — Shopify GraphQL Admin API + D1 logging

تفاصيل الإعداد والقواعد والفخاخ الخاصة بالأداة → [`CLAUDE.md`](./CLAUDE.md).
تقرير الفحص مقابل المهارات (12-09-2026) → [`AUDIT-12-09-2026.md`](./AUDIT-12-09-2026.md).

---

آخر تحديث: 12-10-2026 — 10:30

</div>
