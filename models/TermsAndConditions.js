const mongoose = require('mongoose');

const clauseSchema = new mongoose.Schema({
  clauseId: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  isMandatory: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 1,
  },
}, { _id: false });

const signatureAuditSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  userName: {
    type: String,
    default: '',
  },
  userPhone: {
    type: String,
    default: '',
  },
  signedName: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
  },
  ipAddress: {
    type: String,
    default: '',
  },
  version: {
    type: String,
    default: '1.0',
  },
  clausesAccepted: {
    type: [String],
    default: [],
  },
  acceptedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

const termsAndConditionsSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['customer', 'rider', 'supplier'],
    required: true,
    unique: true,
  },
  version: {
    type: String,
    default: '1.0',
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'hi',
  },
  isPublished: {
    type: Boolean,
    default: true,
  },
  publishedAt: {
    type: Date,
    default: Date.now,
  },
  clauses: [clauseSchema],
  signatures: [signatureAuditSchema],
}, {
  timestamps: true,
});

// Default Hindi Terms data for 3 roles
const defaultTermsData = [
  {
    role: 'customer',
    version: '1.0',
    title: 'Ride Hub — ग्राहक सेवा नियम एवं शर्तें (Customer Terms & Conditions)',
    description: 'Ride Hub ऐप पर ऑर्डर एवं सेवाओं का उपयोग करने से पहले कृपया इन नियमों को ध्यान से पढ़ें एवं सहमति दें।',
    clauses: [
      {
        clauseId: 'cust_1_account',
        order: 1,
        title: '१. खाता सुरक्षा एवं सही जानकारी',
        content: 'ग्राहक अपना वास्तविक नाम, वैध मोबाइल नंबर एवं सही डिलीवरी पता दर्ज करने के लिए जिम्मेदार है। एक खाते का दुरुपयोग होने पर खाता तत्काल निलंबित किया जा सकता है।',
        isMandatory: true,
      },
      {
        clauseId: 'cust_2_cancellation',
        order: 2,
        title: '२. ऑर्डर रद्दीकरण एवं रिफंड नीति',
        content: 'रेस्तरां/सप्लायर द्वारा खाना या सामान तैयार करने से पहले रद्दीकरण पर पूरा रिफंड मिलेगा। यदि खाना तैयार हो चुका है या राइडर रेस्तरां पहुँच चुका है, तो खाद्य बर्बादी और राइडर क्षतिपूर्ति के कारण नियमानुसार कटौती लागू होगी।',
        isMandatory: true,
      },
      {
        clauseId: 'cust_3_rider_comp',
        order: 3,
        title: '३. राइडर की ₹20 आगमन सुरक्षा',
        content: 'यदि राइडर स्टोर/रेस्तरां पहुँच चुका है और ग्राहक द्वारा ऑर्डर रद्द किया जाता है, तो राइडर के समय एवं ईंधन व्यय हेतु ₹20 की अनिवार्य भरपाई राशि काटी जा सकती है।',
        isMandatory: true,
      },
      {
        clauseId: 'cust_4_delivery_conduct',
        order: 4,
        title: '४. डिलीवरी एवं शिष्टाचार',
        content: 'राइडर के आगमन पर समय पर डिलीवरी प्राप्त करें तथा सही डिलीवरी OTP साझा करें। राइडर एवं सप्लायर पार्टनर के साथ सम्मानजनक एवं सुरक्षित व्यवहार करें।',
        isMandatory: true,
      },
    ],
  },
  {
    role: 'rider',
    version: '1.0',
    title: 'Ride Hub — राइडर / डिलीवरी पार्टनर नियम एवं शर्तें (Rider Terms & Conditions)',
    description: 'डिलीवरी पार्टनर के रूप में कार्य करने, सुरक्षा, भुगतान एवं अनिवार्य आगमन पारिश्रमिक के हिंदी नियम।',
    clauses: [
      {
        clauseId: 'rider_1_verification',
        order: 1,
        title: '१. दस्तावेज सत्यापन एवं लाइव उपस्थिति',
        content: 'राइडर के पास वैध ड्राइविंग लाइसेंस, वाहन पंजीकरण एवं सक्रिय बीमा होना अनिवार्य है। ड्यूटी के दौरान वास्तविक जीपीएस लोकेशन साझा करना आवश्यक है।',
        isMandatory: true,
      },
      {
        clauseId: 'rider_2_arrival_guarantee',
        order: 2,
        title: '२. ₹20 सुनिश्चित आगमन पारिश्रमिक (Guaranteed Arrival Fee)',
        content: 'जब राइडर स्टोर/रेस्तरां पहुँच जाता है और सिस्टम में आगमन दर्ज हो जाता है, यदि ग्राहक या स्टोर द्वारा ऑर्डर रद्द होता है, तो राइडर को ₹20 का न्यूनतम सुनिश्चित आगमन भुगतान मिलेगा।',
        isMandatory: true,
      },
      {
        clauseId: 'rider_3_delivery_safety',
        order: 3,
        title: '३. खाद्य सुरक्षा एवं हाइजीन',
        content: 'ऑर्डर को सुरक्षित थर्मल बैग में ले जाएँ। पार्सल के साथ कोई छेड़छाड़ न करें और केवल ओटीपी (OTP) सत्यापन के बाद ही डिलीवरी पूरी करें।',
        isMandatory: true,
      },
      {
        clauseId: 'rider_4_payouts',
        order: 4,
        title: '४. वॉलेट एवं पारदर्शी भुगतान',
        content: 'डिलीवरी शुल्क, दूरी भत्ता एवं आगमन शुल्क सीधे वॉलेट में जमा होंगे। राइडर बैंक खाते या यूपीआई में पारदर्शी रूप से निकासी का अनुरोध कर सकते हैं।',
        isMandatory: true,
      },
    ],
  },
  {
    role: 'supplier',
    version: '1.0',
    title: 'Ride Hub — सप्लायर / रेस्तरां पार्टनर नियम एवं शर्तें (Supplier Terms & Conditions)',
    description: 'रेस्तरां और सप्लायर पार्टनर्स के लिए मेनू प्रबंधन, कैटेगरी अनुमोदन एवं ऑर्डर पूर्ति के नियम।',
    clauses: [
      {
        clauseId: 'supp_1_category_restriction',
        order: 1,
        title: '१. अधिकृत कैटेगरी एवं आइटम प्रतिबंध',
        content: 'सप्लायर केवल एडमिन द्वारा स्वीकृत अपनी आधिकारिक बिजनेस कैटेगरी में ही आइटम लिस्ट कर सकता है। अनधिकृत या गलत कैटेगरी में सामान जोड़ना प्रतिबंधित है।',
        isMandatory: true,
      },
      {
        clauseId: 'supp_2_realtime_stock',
        order: 2,
        title: '२. रियल-टाइम ऑनलाइन/ऑफलाइन एवं स्टॉक स्टेटस',
        content: 'जब दुकान खुली हो तभी ऑनलाइन रहें। सामान समाप्त होने पर उसे तुरंत आउट-ऑफ-स्टॉक करें। जब स्टोर ऑफलाइन होगा, तो ग्राहक ऐप से सभी लिस्टिंग्स स्वतः हट जाएँगी।',
        isMandatory: true,
      },
      {
        clauseId: 'supp_3_quality_packaging',
        order: 3,
        title: '३. खाद्य गुणवत्ता एवं स्वच्छ पैकेजिंग',
        content: 'एफएसएसएआई (FSSAI) मानकों के अनुरूप ताजा, स्वच्छ एवं उच्च गुणवत्ता वाला सामान सुरक्षित सील-पैक डिब्बों में राइडर को सौंपें।',
        isMandatory: true,
      },
      {
        clauseId: 'supp_4_financial_settlement',
        order: 4,
        title: '४. पारदर्शी वित्तीय हिसाब एवं कमीशन',
        content: 'स्वीकृत ऑर्डर के तैयार होने के बाद रद्द होने की स्थिति में रेस्तरां को 80% तक ग्रॉस वैल्यू सुरक्षा प्राप्त होगी। सभी कमीशन एवं कटौती की स्पष्ट रसीद उपलब्ध होगी।',
        isMandatory: true,
      },
    ],
  },
];

termsAndConditionsSchema.statics.seedDefaultTerms = async function() {
  for (const item of defaultTermsData) {
    const existing = await this.findOne({ role: item.role });
    if (!existing) {
      await this.create(item);
      console.log(`📜 [TERMS SEEDED] Default Hindi Terms created for role: ${item.role}`);
    }
  }
};

module.exports = mongoose.model('TermsAndConditions', termsAndConditionsSchema);
