<div dir="rtl" style="text-align: right;">

# جرد المخزون (`inventory-audit-updater`)

![version](https://img.shields.io/badge/version-v2.1.0-blue)

**بتعمل إيه:** الموظفين بيراجعوا أرصدة المخزون بالباركود/SKU، يصلّحوا الفرق (`adjust_inventory`)، أو يأكّدوا إن الجرد مظبوط (`set_audit_date`) — مع قايمة أولويات جرد وتفاصيل الأوردرات الغير مجهّزة لكل صنف.
**مين بيستخدمها:** المخزن
**الإصدار:** Worker `v5.0.0` · الواجهة `v5.1.0`

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
| `get_details` | الأوردرات الغير مجهّزة لصنف — بيرجّع `orderId` الرقمي كمان |
| `get_audit_date` | آخر تاريخ/موظف/ملاحظات جرد لصنف |
| `get_audit_priorities` | قايمة أولويات الجرد + `truncated` لو عدّى السقف |
| `adjust_inventory` | تصحيح الرصيد (POST) + تسجيل تاريخ الجرد |
| `set_audit_date` | تأكيد إن الجرد مظبوط من غير تعديل (POST) |
| `get_logs` | صفحة واحدة من السجل (100 صف) — فلترة وترتيب server-side |
| `get_logs_count` | العدد الكلي المطابق للفلاتر |
| `get_logs_export` | التصدير لحد `LOG_EXPORT_MAX` + `{cap, total, truncated}` |
| `diag` | فحص ذاتي بدون كتابة (env · D1 · OAuth · الصلاحيات · LOCATION_ID · التوقيت · CORS) |
| `get_config` | نسخة الـ Worker — الواجهة بتقارنها بـ `MIN_WORKER_VERSION` |

## D1

```
tool  : inventory_audit
type  : ok · adjustment · login · logout
```

> القيم دي مسجّلة بالفعل في جدول D1 في `ecommoda-constants` §7.
> ⛔ **ممنوع أي `writeLog` بقيمة `type` مش في السطر ده** قبل ما تتسجّل هناك.

### نتيجة العملية — `extra.result`

من v5.0.0 كل صف كتابة بياخد `extra.result` (المفردات الرسمية → `constants` §12):

| القيمة | معناها في الأداة دي |
|---|---|
| `success` | التعديل/التأكيد تم واتأكد من شوبيفاي |
| `warning` | **الكمية اتعدّلت فعلاً** لكن تاريخ الجرد ما اتكتبش — مراجعة يدوية، **ومتعيدش التعديل** |
| `error` | النداء وصل لشوبيفاي واترفض — مفيش أي أثر على المخزون |

> `already` و`rejected` **مش منطبقين هنا** — كل نداء كتابة في الأداة دي بيحاول
> فعل حقيقي، مفيش مسار بيتوقف قبل المحاولة.

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

## خط الأساس

> من D1 مباشرة (آخر صفوف نجاح **قبل** النقل — 27-08-2026):

```
login      : 196 صف · آخر واحد 2026-08-27T12:23:45Z
adjustment : 675 صف · آخر واحد 2026-08-24T12:39:23Z
ok         : 920 صف · آخر واحد 2026-07-29T09:16:42Z
logout     : 4 صف   · آخر واحد 2026-07-28T07:47:39Z
```

### ⚠️ استعلام خط الأساس — الصيغة الصحيحة

الاستعلام اللي بيعدّ `type` لوحده **بيقيس المحاولات مش الكتابة الفعلية**
(`constants` §12). من v5.0.0 الأداة بتسجّل الفشل كمان، فالصيغة الصح:

```sql
-- ✅ الكتابة الفعلية
SELECT COUNT(*) FROM logs
 WHERE tool = 'inventory_audit' AND type = 'adjustment'
   AND (json_extract(extra,'$.result') = 'success'
        OR json_extract(extra,'$.result') IS NULL);   -- الصفوف قبل v5.0.0 نجاح بالتعريف

-- ❌ بيقيس المحاولات
SELECT COUNT(*) FROM logs WHERE tool = 'inventory_audit' AND type = 'adjustment';
```

> الصفوف الأقدم من v5.0.0 مالهاش `extra.result` — الأداة وقتها ماكانتش بتسجّل
> إلا عند النجاح، فغياب الحقل معناه نجاح. **والواجهة بتعرضها «—» مش «✓»** لأن
> على مستوى الصف الواحد إحنا فعليًا مش عارفين.

## فخاخ الأداة دي

- **الأداة بتعتمد على `LOCATION_ID` في `adjustInventory`** — لو ضاع من
  `[vars]`، `requireLocationId()` بترمي برسالة باسمه **قبل** أي كتابة
  (من v5.0.0). قبل كده كان بيتحوّل لـ `gid://.../undefined` ويفشل جوّه
  الميوتيشن. برضه لازم يتأكد من الداشبورد بعد أي نقل.
- **`delta` نسبي مش مطلق.** إعادة تنفيذ نفس التعديل بتضاعفه. عشان كده نتيجة
  `warning` بتقول صراحةً «متعيدش التعديل» — الكمية اتحركت خلاص.
- **رابط الواجهة بقى constant في الكود** (`WORKER_URL` في `§CONFIG`) — مش في
  `localStorage` ومش حقل إعدادات. الموظف اللي عنده `stockaudit_worker_url`
  قديم محفوظ في المتصفح مش هيتأثر، القيمة بقت متجاهلة.
- **السر الوحيد في `localStorage`:** `stockaudit_worker_secret` — وبس.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (2.1.html · 2.5.html · 3.html · 4.html) و Index.html
القديمة (v3.1.0) محفوظة في commit e33b484 (آخر commit قبل تنظيف الواجهة).
git show e33b484:2.1.html
git show e33b484:2.5.html
git show e33b484:3.html
git show e33b484:4.html        ← ده نفس محتوى index.html بتاع v4.0.1
git show e33b484:Index.html    ← كان v3.1.0 قبل التحويل لصفحة تحويل

نسخة ما قبل مراجعة 12-09-2026 (Worker v4.0.0 · الواجهة v4.0.1):
git show 7f0cce9:index.js
git show 7f0cce9:index.html
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.0.0 |
| ecommoda-html-builder | v7.0.0 |
| ecommoda-constants | v2.1.0 |
| shopify-graphql-helper | v1.0.0 |

آخر مطابقة: 12-09-2026 · `index.js` v5.0.0 · `index.html` v5.1.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

### ✅ Flow Companion — اتشال بالكامل (12-09-2026)

الأداة كان فيها زرار **«✅ Fulfill Orders»** في كارت الأوردرات غير المشحونة:
تحدّد أوردرات، والأداة تبعت trigger لـ Flow Companion (`specifier: FULFILL`)
**من متصفح الموظف مباشرةً**، بتوكن في `localStorage`، و**بدون أي صف في D1**.

**اتشال نهائيًا في `index.html` v5.1.0** — الزرار وخانات التحديد وحقل التوكن
والدوال كلها، والمفتاح القديم `stockaudit_flow_token` بيتمسح تلقائيًا من متصفح
كل موظف عند أول فتح.

**سبب القرار (أحمد، 12-09-2026):** الميزة **مكانتش بتتستخدم**، و**مكانش المفروض
تكون موجودة** — الأداة دي أداة جرد، والـ fulfillment مرحلة شحن. مخالفة القاعدة ١
في `ecommoda-worker-builder` (أداة واحدة = وظيفة واحدة).

**ملاحظات للأرشيف:**

- الميزة كانت موجودة من **أقدم نسخة محفوظة** (`2.1.html`) وعمرها ما اتوثّقت —
  لا في الـ Changelog ولا هنا، والـ Worker ماكانش يعرف عنها حاجة.
- **مافيش طريقة نعرف كانت بتتستخدم قد إيه** لأنها ماكانتش بتكتب في D1 أصلًا.
  دي حلقة مقفولة: الحاجة الناقصة هي نفسها اللي بتمنع الإجابة. لو ظهر بعدين إن
  حد محتاجها، **تتبني من الصفر في أداة الشحن** مش هنا.
- **مفيش قيمة `type` جديدة اتسجّلت** في `ecommoda-constants` §7 — الحذف قفل
  البند من غير ما يلمس المهارة المشتركة.
- كارت الأوردرات غير المشحونة **باقي زي ما هو للعرض** — هو معلومة مهمة وقت
  الجرد (بيحسب `currentShelfQty`). اللي اتشال هو **الفعل** بس.
- استرجاع الكود لو احتاجت: `git show fe50cf8:index.html`

### باقي المفتوح

- **Build watch paths لسه على `*` الافتراضي** — ممكن يتضيّق لاحقًا لـ
  `index.js` + `wrangler.toml` زي §13-ب في playbook النقل، مش إلزامي دلوقتي.
- **`ALLOWED_ORIGINS`** — بند التنظيف فوق لسه محتاج تأكيد أحمد.
- **أي الملف كان فعليًا الأحدث قبل النقل** (`4.html` v4.0.1) اتفرض إنه هو
  المصدر الصحيح لـ `index.html`. `Index.html` (v3.1.0) كان أقدم وتحوّل لصفحة
  تحويل بدل ما يتشال — **قرار محتاج تأكيد أحمد**.

## التحقق قبل أي تسليم

```bash
# الـ Worker
node --check index.js

# الواجهة — التلاتة مع بعض، ولا واحد بديل عن التاني
node <skill>/scripts/css-check.js index.html      # Step 9A — البارسر
node <skill>/scripts/js-undef-check.js index.html # Step 9B — الربط
# + فحوص Step 9 بالـ grep (z-index · التوكنز · الكلاسات المهجورة)
```

> ⚠️ **وحارس نسخة الـ Worker يتجرّب في الاتجاهين**: مرة بـ
> `MIN_WORKER_VERSION` الصح (التحذير مختفي) ومرة برقم أعلى من نسخة الـ Worker
> (التحذير يظهر). الاختبار السلبي لوحده بيقول إن الحارس **ساكت**، مش إنه شغّال.

---

آخر تحديث: 12-09-2026 — 16:20

</div>
