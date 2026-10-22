SIMO v2.1 — دليل النشر السريع

== متغيرات Railway (Variables) ==
DATABASE_URL     رابط Neon (بدون -pooler وبدون channel_binding)
DATABASE_SSL     1
JWT_SECRET       نص عشوائي طويل (32 حرفًا على الأقل)
ADMIN_PHONE      رقمك (06xxxxxxxx) — اختياري إن استعملت ADMIN_EMAIL
ADMIN_EMAIL      بريد Gmail الخاص بالإدارة (دخول بـ Google)
ADMIN_PASSWORD   كلمة سر إضافية لحساب الإدارة (اختر كلمة قوية)
GOOGLE_CLIENT_ID معرّف OAuth من Google Cloud
DEV_OTP          1 للتجربة فقط — اجعله 0 عند الإطلاق
TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM   لإرسال رمز SMS (اختياري إن اعتمد الجميع Google)
VAPID_*          لا تحتاجها: تُولَّد مفاتيح الإشعارات تلقائيًا

== الصفحات ==
/            الزبائن
/staff.html  الإدارة والتجار والموزعون
/legal       الشروط والخصوصية (أكمل الحقول المظللة)
/health      فحص الخادم

== قبل الإطلاق ==
1) جرّب الدخول بـ Google للإدارة (ADMIN_EMAIL + ADMIN_PASSWORD) قبل جعل DEV_OTP=0
2) أكمل صفحة legal.html بمعلوماتك القانونية
3) غيّر كلمة سر قاعدة البيانات في Neon وحدّثها في Railway
4) احذف المتاجر التجريبية وأضف متاجرك وصورها من لوحة الإدارة
