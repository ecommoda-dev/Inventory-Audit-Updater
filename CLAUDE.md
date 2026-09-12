# جرد المخزون (`inventory-audit-updater`)

**بتعمل إيه:** الموظفين بيراجعوا أرصدة المخزون بالباركود/SKU، يصلّحوا الفرق (`adjust_inventory`)، أو يأكّدوا إن الجرد مظبوط (`set_audit_date`) — مع قايمة أولويات جرد وتفاصيل الأوردرات الغير مجهّزة لكل صنف.
**مين بيستخدمها:** المخزن
**الإصدار:** Worker `v4.0.0` · الواجهة `v4.0.1`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Inventory-Audit-Updater/
الـ Worker : https://inventory-audit-updater-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: inventory-audit-updater-worker     ← لازم يطابق name في wrangler.toml
```

## الـ Endpoints

| `?action=` | بيعمل إيه |
|---|---|
| `check_employee` | فحص موظف قبل تسجيل الدخول |
| `register_pin` | تسجيل PIN لأول مرة |
| `verify_employee` | تسجيل الدخول (PIN) |
| `log_logout` | تسجيل خروج |
| `get_employees` | قايمة الموظفين النشطين |
| `list_skus` | بحث عن SKU/منتج |
| `lookup_barcode` | بحث بالباركود (سكانر) |
| `get_details` | الأوردرات الغير مجهّزة لصنف معيّن |
| `get_audit_date` | آخر تاريخ/موظف/ملاحظات جرد لصنف |
| `get_audit_priorities` | قايمة أولويات الجرد (كل المتجر) |
| `adjust_inventory` | تصحيح الرصيد (POST) + تسجيل تاريخ الجرد |
| `set_audit_date` | تأكيد إن الجرد مظبوط من غير تعديل (POST) |
| `get_logs` | سجل العمليات |

## D1

```
tool  : inventory_audit
type  : ok · adjustment · login · logout
```

> القيم دي مسجّلة بالفعل في جدول D1 في `ecommoda-constants` §7.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET
Vars     : SHOP_DOMAIN · LOCATION_ID   ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي — لسه ما اتضيّقتش، §13-ب مفتوح)
```

## CORS

`ALLOWED_ORIGINS` صارمة (`https://ecommoda-dev.github.io` بس) — لأن الأداة كتابة (بتعدّل رصيد المخزون فعليًا).

> 🔴 **تنظيف تم أثناء النقل (27-08-2026):** الكود المنشور قبل النقل كان فيه
> كمان `https://ecommoda24.github.io` (حساب/دومين مهجور) في `ALLOWED_ORIGINS` —
> مذكور صراحةً في `ecommoda-constants` §11 بند 10 كتنظيف كود مطلوب. اتشال في
> `index.js` أثناء النقل. **قرار محتاج تأكيد أحمد** (مش تخمين بلا سند — الشيل
> موثّق في السكيل، بس التنفيذ حصل هنا لأول مرة).

## خط الأساس بعد النقل

> من D1 مباشرة (آخر صفوف نجاح **قبل** النقل — 27-08-2026):

```
login      : 196 صف · آخر واحد 2026-08-27T12:23:45Z
adjustment : 675 صف · آخر واحد 2026-08-24T12:39:23Z
ok         : 920 صف · آخر واحد 2026-07-29T09:16:42Z
logout     : 4 صف   · آخر واحد 2026-07-28T07:47:39Z
```

> بعد الربط، افتح الأداة واضغط "تحديث" — الأرقام (نتايج البحث/الأولويات)
> المفروض تكمل عادي زي قبل النقل. مفيش خط أساس رقمي "كمية منتجات" واضح
> اتسجّل قبل النقل — لو أحمد عايز واحد، يتسجّل من الأداة وهي شغالة.

## فخاخ الأداة دي

- **الأداة بتعتمد على `LOCATION_ID` في `adjustInventory`** — لو ضاع من
  `[vars]`، الـ mutation هترمي `userError` (ID غير صالح) مش صفر نتايج صامت،
  لكن برضه لازم يتأكد من الداشبورد بعد النقل (§4-أ-٢ في playbook النقل).
- **رابط الواجهة قبل النقل كان بيتحفظ في `localStorage` يدويًا** من شاشة
  الإعدادات (`stockaudit_worker_url` / `stockaudit_worker_secret` /
  `admin_worker_url`) — مش هارد-كودد في الـ HTML. الموظف اللي عنده الرابط
  القديم محفوظ في المتصفح لازم يفتح الإعدادات ويتأكد إن رابط الـ Worker
  لسه صح بعد أي تغيير (الاسم نفسه ما اتغيّرش في هذا النقل، فمفروض يفضل شغال).

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (2.1.html · 2.5.html · 3.html · 4.html) و Index.html
القديمة (v3.1.0) محفوظة في commit e33b484 (آخر commit قبل تنظيف الواجهة).
git show e33b484:2.1.html
git show e33b484:2.5.html
git show e33b484:3.html
git show e33b484:4.html        ← ده نفس محتوى index.html الحالي
git show e33b484:Index.html    ← كان v3.1.0 قبل التحويل لصفحة تحويل
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.0.0 |
| ecommoda-constants | v1.2.0 |

آخر مطابقة: 27-08-2026 · `index.js` v4.0.0 · `index.html` v4.0.1
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- **Build watch paths لسه على `*` الافتراضي** — ممكن يتضيّق لاحقًا لـ
  `index.js` + `wrangler.toml` زي §13-ب في playbook النقل، مش إلزامي دلوقتي.
- **أي الملف كان فعليًا الأحدث قبل النقل** (`4.html` v4.0.1) اتفرض إنه هو
  المصدر الصحيح لـ `index.html` الجديد، لأن رقم إصداره بيطابق أحدث CHANGELOG
  في كود الـ Worker (v4.0.0 — إضافة `vendor`). `Index.html` (v3.1.0) كان أقدم
  وتحوّل لصفحة تحويل بدل ما يتشال — **قرار محتاج تأكيد أحمد**.
