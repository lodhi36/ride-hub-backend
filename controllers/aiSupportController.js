// backend 3/controllers/aiSupportController.js
const Booking = require('../models/Booking');
const User = require('../models/User');
const SupportCase = require('../models/SupportCase');
const AIChatLog = require('../models/AIChatLog');
const aiConfig = require('../config/aiConfig');

// Active Order Statuses
const ACTIVE_ORDER_STATUSES = [
  'BOOKING_REQUESTED',
  'PENDING',
  'PENDING_RESTAURANT',
  'RINGING',
  'RESTAURANT_ACCEPTED',
  'PREPARING',
  'FOOD_PREPARING',
  'FOOD_READY',
  'READY_FOR_PICKUP',
  'READY',
  'SEARCHING_FOR_RIDER',
  'OUT_FOR_DELIVERY',
  'ON_THE_WAY',
  'PICKED_UP',
  'ACCEPTED',
  'ACCEPTED_BY_RIDER',
  'REACHED_PICKUP',
  'PROVIDER_ASSIGNED',
  'PROVIDER_ACCEPTED',
  'PROVIDER_ON_THE_WAY',
  'PROVIDER_ARRIVED',
  'STARTED',
  'SERVICE_STARTED',
];

// ── Role-specific Quick Buttons ──────────────────────────────
const QUICK_BUTTONS = {
  customer_no_orders: [
    { id: 'how_to_order', label: '🛍️ Order kaise place karein?', prompt: 'Ride Hub par order kaise place karein? Step-by-step tareeka batayein.' },
    { id: 'place_order_problem', label: '⚠️ Order place karne mein problem', prompt: 'Mujhe order place karne mein problem aa rahi hai / payment issue hai.' },
    { id: 'refund_policy', label: '📜 Refund policy kya hai?', prompt: 'Ride Hub ki refund policy aur cancellation niyam kya hain?' },
    { id: 'open_restos', label: '🏪 Kaun se store khule hain?', prompt: 'Abhi kaun se restaurant ya store online khule hain?' },
    { id: 'payment_methods', label: '💳 Payment ke tareeke', prompt: 'Payment karne ke kaun se tareeke uplabdh hain?' },
  ],
  customer_active_orders: [
    { id: 'where_is_order', label: '📍 Mera order kahan hai?', prompt: 'Mera order kahan hai aur kitna samay lagega?' },
    { id: 'cancel_order', label: '❌ Cancel request bhejein', prompt: 'Mujhe apna order cancel karna hai' },
    { id: 'report_issue', label: '⚠️ Galat ya kharab saman', prompt: 'Mere order mein item galat ya kharab mila hai' },
    { id: 'talk_human', label: '🎧 Support team se baat karein', prompt: 'Mujhe human support executive se baat karni hai' },
  ],
  supplier: [
    { id: 'new_orders', label: '📦 Naye orders check karein', prompt: 'Kya mere store par naye orders aaye hain?' },
    { id: 'settlement', label: '💰 Settlement kab aayega?', prompt: 'Mera payment ya settlement kab aayega?' },
    { id: 'out_of_stock', label: '🚫 Item out of stock karna', prompt: 'Menu item ko band ya out of stock kaise karein?' },
    { id: 'store_support', label: '🎧 Store Support', prompt: 'Store related technical dikkat hai, support team se baat karni hai' },
  ],
  rider: [
    { id: 'active_delivery', label: '📍 Active delivery details', prompt: 'Meri active delivery ki pickup aur drop jaankari batao' },
    { id: 'customer_unreachable', label: '📞 Customer phone nahi utha raha', prompt: 'Customer location par phone nahi utha raha hai, kya karoon?' },
    { id: 'pickup_delay', label: '⏳ Store par order ready nahi hai', prompt: 'Restaurant par order ready nahi hua hai aur delay ho raha hai' },
    { id: 'my_earnings', label: '💵 Meri kamai kitni hai?', prompt: 'Meri aaj ki aur is hafte ki kamai kitni hai?' },
    { id: 'sos_support', label: '🚨 Emergency / Support', prompt: 'Mujhe urgent support team se baat karni hai' },
  ],
};

// ── Language Detection Helper ─────────────────────────────────
function detectLanguage(text) {
  if (!text) return 'hindi';
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';

  const lower = text.toLowerCase().trim();

  const englishPhrases = [
    'how to', 'how can', 'where is', 'where are', 'what is', 'what are', 'i want',
    'please', 'help me', 'my order', 'order status', 'refund policy', 'cancellation policy',
    'thank you', 'thanks', 'good morning', 'good evening', 'good afternoon', 'can you',
    'which store', 'is open', 'payment method', 'money deducted', 'not working',
    'problem with', 'delivery charge', 'track my', 'talk to agent', 'human support', 'cancel order'
  ];
  for (const phrase of englishPhrases) {
    if (lower.includes(phrase)) return 'english';
  }

  const hinglishWords = [
    'karna', 'karein', 'kare', 'kaise', 'kahan', 'mera', 'meri', 'mere', 'mujhe',
    'humko', 'aapka', 'aapki', 'aapke', 'hai', 'hain', 'nahi', 'batao', 'batayein',
    'kab', 'aayega', 'aayegi', 'kitna', 'paise', 'dikkat', 'shikayat', 'khula',
    'khule', 'dhanyawad', 'shukriya', 'chahiye', 'raha', 'rahi', 'samasya', 'kya',
    'bhejo', 'bhai', 'namaste', 'bataiye', 'lagana', 'kat', 'gaya', 'gaye', 'fas'
  ];
  for (const h of hinglishWords) {
    if (new RegExp(`\\b${h}\\b`, 'i').test(lower)) {
      return 'hindi';
    }
  }

  const pureEnglishWords = new Set([
    'hi', 'hello', 'hey', 'order', 'refund', 'payment', 'stores', 'status', 'help',
    'tracking', 'cancel', 'thanks', 'welcome', 'support', 'problem', 'rider', 'menu', 'cart'
  ]);
  const words = lower.split(/\s+/);
  if (words.length === 1 && pureEnglishWords.has(words[0])) {
    return 'english';
  }

  if (/\b(the|is|are|am|i|you|to|for|with|and|my|in|on|at|how|what|where)\b/i.test(lower)) {
    return 'english';
  }

  return 'hindi';
}

// ── Smart Rule-Based Engine (Fallback when LLM_API_KEY is unset or API offline) ──
function generateSmartFallbackResponse(userRole, message, context) {
  const text = (message || '').toLowerCase().trim();
  const rawName = context.userName;
  const hasValidName = rawName && rawName !== 'User' && rawName !== 'Customer' && rawName !== 'Guest' && rawName !== 'guest_user';
  const salutationHindi = hasValidName ? `${rawName} जी` : 'सर';
  const salutationEnglish = hasValidName ? rawName : 'sir';
  const isEnglish = detectLanguage(text) === 'english';

  // 0. Natural Human Greeting Handler
  const isGreeting = /^(hi|hello|hey|namaste|namaskar|hlo|hii|helo|kem cho|good\s*(morning|afternoon|evening)|salaam|sasriyakaal)[\s!.]*$/i.test(text) ||
                     text === 'hi' || text === 'hello' || text === 'hey' || text === 'namaste' || text === 'hii' || text === 'hlo';

  if (isGreeting) {
    if (isEnglish) {
      return {
        reply: `Hello ${salutationEnglish}! Welcome to Ride Hub. How can I help you today?`,
        action: null,
      };
    } else {
      return {
        reply: `नमस्ते ${salutationHindi}! Ride Hub में आपका स्वागत है। बताइए, मैं आपकी क्या मदद कर सकता हूँ?`,
        action: null,
      };
    }
  }

  // 1. Jailbreak & Admin Spoof resistance
  if (text.includes('ignore previous') || text.includes('bhool jao') || text.includes('main admin') || text.includes('i am admin')) {
    return {
      reply: isEnglish
        ? 'Sorry, I am the official Ride Hub Support Assistant and adhere strictly to platform safety guidelines. How may I assist you with your orders or deliveries today?'
        : 'Kshama karein, main Ride Hub ka AI Support Agent hun aur safety niyam todne ki anumati nahi hai. Main aapki delivery, orders aur app related madad kar sakta hun.',
      action: null,
    };
  }

  // 2. Direct Refund / Money command resistance
  if (text.includes('refund de do') || text.includes('give me refund') || text.includes('paise wapas') || text.includes('give refund')) {
    return {
      reply: isEnglish
        ? 'According to Ride Hub policy, AI agents cannot process direct refunds. For food orders, cancellations after kitchen preparation begins are non-refundable. For non-food orders, product price is refundable excluding delivery fee. Would you like to submit a cancellation and refund request to our support team?'
        : 'Ride Hub ke niyam anusar AI agent seedhe refund process nahi kar sakta. Food orders mein restaurant taiyari shuru karne ke baad refund nahi milta, jabki fashion/other orders mein delivery partner charge chhodkar poora refund milta hai. Kya aap support team ko Cancel & Refund Request bhejna chahte hain?',
      action: 'CANCEL_REQUEST',
    };
  }

  // 3. Human Support Request
  if (text.includes('support') || text.includes('human') || text.includes('agent') || text.includes('call') || text.includes('executive') || text.includes('shikayat') || text.includes('complaint')) {
    return {
      reply: isEnglish
        ? 'Ride Hub Support Team is available 24/7 and usually responds within a minute. I have initiated a support ticket for you; a support executive will connect with you shortly.'
        : 'Ride Hub Support Team 24 ghante uplabdh hai aur aamtaur par 1 minute ke andar jawab deti hai. Maine aapke liye support ticket bana diya hai, team turant aapke sath judegi.',
      action: 'TRANSFER_SUPPORT',
    };
  }

  // 4. Gratitude / Thanks
  if (text.includes('thank') || text.includes('dhanyawad') || text.includes('shukriya') || text.includes('dhanyavad')) {
    return {
      reply: isEnglish
        ? `You're very welcome ${salutationEnglish}! It's our absolute pleasure to assist you. If you need anything else, feel free to ask!`
        : `आपका बहुत-बहुत धन्यवाद ${salutationHindi}! Ride Hub में आपकी सेवा करके मुझे बेहद खुशी हुई। यदि कोई अन्य सहायता चाहिए हो, तो बेझिझक बताएं!`,
      action: null,
    };
  }

  // ── Customer Queries ──
  if (userRole === 'customer') {
    // A. "I want to order" / "Mujhe order karna hai"
    if (text.includes('order karna') || text.includes('order place karna') || text.includes('order lagana') || text.includes('mujhe order') || text.includes('order book') || text === 'order' || text.includes('i want to order') || text.includes('want to place an order')) {
      return {
        reply: isEnglish
          ? `Sure ${salutationEnglish}! I'd be happy to guide you. First, choose your preferred category (Food, Fashion, Grocery) from the Home screen, select a store, and add items to your cart. Next, confirm your delivery address and choose your payment method (UPI, Cards, Cash on Delivery). Which category would you like to explore today?`
          : `बिल्कुल ${salutationHindi}! मैं आपकी मदद करता हूँ। सबसे पहले अपनी पसंद की कैटेगरी (Food, Fashion, Grocery) चुनिए, फिर स्टोर और प्रोडक्ट चुनकर कार्ट में जोड़िए। उसके बाद अपना डिलीवरी एड्रेस चुनें और उपलब्ध पेमेंट विकल्प (UPI, Cards, Cash on Delivery) से ऑर्डर कन्फर्म करें।\n\nआप किस कैटेगरी से ऑर्डर करना चाहते हैं?`,
        action: null,
      };
    }

    // B. Problem placing order / payment deducted issue
    if (text.includes('problem') || text.includes('dikkat') || text.includes('kat gaye') || text.includes('kat gaya') || text.includes('nahi ho raha') || text.includes('issue') || text.includes('fas gaya') || text.includes('deducted') || text.includes('failed')) {
      return {
        reply: isEnglish
          ? `Order & Payment Solutions:\n\n• **Amount deducted but order not placed**: Don't worry ${salutationEnglish}! Bank gateways typically sync within 1-2 minutes. If the order is not confirmed, the amount is automatically refunded to your bank account within 24-48 hours.\n• **Address / Location issue**: Please check your delivery address pin code and exact landmark.\n• **Cart issue**: Please ensure items in your cart belong to a single store.\n\nIf the issue persists, please tap 'Connect with Human Support' below!`
          : `Order Place Karne Mein Samasya / Payment Dikkat Solutions:\n\n• **Paise kat gaye par order nahi bana**: Chinta na karein ${salutationHindi}! Bank gateway 1-2 minute mein sync hota hai. Agar order confirm na ho to payment 24-48 ghante mein auto-refund ho jata hai.\n• **Address / Location issue**: Delivery address mein pin code aur exact landmark check karein.\n• **Cart issue**: Ek samay mein ek hi restaurant/store ke items cart mein add karein.\n\nAgar samasya abhi bhi bani hui hai, to turant "Connect with Human Support" par click karein!`,
        action: 'TRANSFER_SUPPORT',
      };
    }

    // C. How to place order step-by-step
    if (text.includes('kaise') || text.includes('tarika') || text.includes('tareeka') || text.includes('how to') || text.includes('how do i') || (text.includes('order') && (text.includes('place') || text.includes('karein') || text.includes('kare')))) {
      return {
        reply: isEnglish
          ? `Placing an order on Ride Hub is very simple:\n\n1️⃣ **Select Store / Category**: On the Home screen, select your favorite store from Food, Fashion, or Grocery.\n2️⃣ **Add Items**: Pick your desired products and add them to your cart.\n3️⃣ **Confirm Address**: Verify your delivery address and landmark in the cart.\n4️⃣ **Make Payment**: Confirm with UPI (Google Pay, PhonePe, Paytm), Card, or Cash on Delivery (COD).\n\nOnce placed, your order is prepared by the store and tracked live on your screen!`
          : `जी ${salutationHindi}! Ride Hub par order place karna behad saral hai:\n\n1️⃣ **Store / Category Chunein**: Home Screen par Food, Fashion ya Grocery category mein jakar apna manpasand store chunein.\n2️⃣ **Items Add Karein**: Store ke menu se manpasand items Cart mein add karein.\n3️⃣ **Address Confirm Karein**: Cart screen par jakar apna exact delivery address aur landmark confirm karein.\n4️⃣ **Payment Chunein**: UPI (Google Pay, PhonePe, Paytm), Cards ya Cash on Delivery (COD) se payment confirm karein.\n\nJaise hi aap Place Order karenge, store taiyari shuru karega aur delivery partner aapke address tak pahunchayega!`,
        action: null,
      };
    }

    // D. Refund Policy
    if (text.includes('refund') || text.includes('cancellation policy') || text.includes('cancel niyam') || text.includes('niyam')) {
      return {
        reply: isEnglish
          ? `Ride Hub Refund & Cancellation Policy:\n\n🍔 **Food Orders**:\n• Cancellation before restaurant begins kitchen preparation: **100% Full Refund**.\n• Once kitchen preparation starts, 0% refund applies due to perishable food wastage rules.\n\n👗 **Fashion & Grocery / Retail Orders**:\n• Cancellation before dispatch: **100% Full Refund**.\n• After dispatch: Full product price is refunded, excluding only the delivery partner fee.\n\n⚠️ **Damaged / Incorrect Item**: Raise a complaint with a photo in support, and a refund will be processed upon verification.`
          : `Ride Hub Refund & Cancellation Policy:\n\n🍔 **Food Orders**:\n• Restaurant dwara kitchen mein cooking shuru karne se pehle cancel karne par: **100% Refund**.\n• Cooking/taiyari shuru hone ke baad food wastage niyam ke tahat 0% refund rehta hai.\n\n👗 **Fashion & Grocery / Retail Orders**:\n• Dispatch hone se pehle: **100% Refund**.\n• Dispatch ke baad: Delivery partner charge deduct karke baki **poora refund** milta hai.\n\n⚠️ **Kharab ya Galat Item**: Photo ke sath support ticket raise karein, verify hote hi refund aapke account mein transfer ho jayega.`,
        action: null,
      };
    }

    // E. Online Stores Real-time
    if (text.includes('restaurant') || text.includes('dukaan') || text.includes('khula') || text.includes('khule') || text.includes('open') || text.includes('store')) {
      if (!context.onlineStores || context.onlineStores.length === 0) {
        return {
          reply: isEnglish
            ? `Sorry ${salutationEnglish}, no stores or restaurants are currently online in your area. Please check back shortly.`
            : `माफ़ कीजिए ${salutationHindi}, अभी सिस्टम में कोई रेस्टोरेंट या स्टोर ऑनलाइन नहीं है। कृपया थोड़ी देर बाद दोबारा चेक करें।`,
          action: null,
        };
      }
      const storeNames = context.onlineStores.slice(0, 6).map(s => `• ${s.name} (${s.category || 'Store'})`).join('\n');
      return {
        reply: isEnglish
          ? `Here are the stores currently open and accepting orders live:\n\n${storeNames}\n\nYou can tap on any of these stores on the Home screen to place your order!`
          : `जी ${salutationHindi}! अभी लाइव ऑनलाइन खुले हुए रेस्टोरेंट्स और स्टोर्स:\n\n${storeNames}\n\nआप इनमें से किसी भी स्टोर पर टैप करके लाइव ऑर्डर प्लेस कर सकते हैं!`,
        action: null,
      };
    }

    // F. Payment Methods
    if (text.includes('payment') || text.includes('upi') || text.includes('cod') || text.includes('tareeke') || text.includes('tarike') || text.includes('how to pay')) {
      return {
        reply: isEnglish
          ? `Available Payment Methods on Ride Hub:\n\n• **UPI**: Google Pay, PhonePe, Paytm, BHIM UPI for instant payment.\n• **Cards**: Debit Card & Credit Card (Visa, MasterCard, RuPay).\n• **Net Banking**: Supported across all major Indian banks.\n• **Cash on Delivery (COD)**: Pay cash or scan QR code upon delivery.\n\nAll transactions are 100% secure and encrypted.`
          : `Ride Hub पर भुगतान के उपलब्ध तरीके:\n\n• **UPI**: Google Pay, PhonePe, Paytm, BHIM UPI से तुरंत पेमेंट।\n• **Cards**: Debit Card & Credit Card (Visa, MasterCard, RuPay)।\n• **Net Banking**: सभी प्रमुख भारतीय बैंकों द्वारा।\n• **Cash on Delivery (COD)**: डिलीवरी मिलने पर नकद या QR कोड स्कैन करके पेमेंट करें।\n\nसभी लेन-देन 100% सुरक्षित और एन्क्रिप्टेड हैं।`,
        action: null,
      };
    }

    // G. Where is order
    if (!context.hasActiveOrder && (text.includes('kahan hai') || text.includes('track') || text.includes('status') || text.includes('mera order') || text.includes('where is my order'))) {
      return {
        reply: isEnglish
          ? `You currently have no active orders in progress. If you would like to place an order, please choose a store from the Home screen! If payment was deducted, please choose 'Problem with order'.`
          : `माफ़ कीजिए ${salutationHindi}, अभी आपके खाते में कोई ऐक्टिव ऑर्डर नहीं चल रहा है। यदि आपने नया ऑर्डर करना है तो 'ऑर्डर कैसे करें' चुनें या होम स्क्रीन से स्टोर से ऑर्डर करें! अगर पैसे कट गए हैं तो 'ऑर्डर प्लेस समस्या' चुनें।`,
        action: null,
      };
    }

    if (context.hasActiveOrder && context.latestOrder && (text.includes('kahan hai') || text.includes('status') || text.includes('track') || text.includes('kab aayega') || text.includes('where is my order'))) {
      const o = context.latestOrder;
      return {
        reply: isEnglish
          ? `Your active order #${o.bookingId} (${o.serviceName || 'Store Order'}) at ${o.restaurantName || 'Partner Store'} is currently '${o.status}'. You can track your delivery partner live on the map once assigned!`
          : `जी ${salutationHindi}! आपका ऐक्टिव ऑर्डर #${o.bookingId} (${o.serviceName || 'Store Order'}) की वर्तमान स्थिति है: "${o.status}"। स्टोर: ${o.restaurantName || 'Partner Store'}। राइडर असाइन होते ही आप लाइव ट्रैकिंग स्क्रीन पर रियल-टाइम देख सकेंगे!`,
        action: null,
      };
    }

    if (text.includes('cancel')) {
      return {
        reply: isEnglish
          ? `Cancellation Policy: Food orders cannot be refunded once kitchen preparation starts. For fashion and other non-food categories, full product price is refunded excluding the delivery fee. Would you like to submit a cancellation request to our support team?`
          : `Cancel Niyam: Food orders mein store dwara taiyari shuru hone ke baad cancel karne par refund nahi milta. Fashion ya doosri category mein cancel karne par sirf delivery partner charge deduct hota hai, baaki raqam refund hoti hai. Kya aap Cancel Request bhejna chahte hain ${salutationHindi}?`,
        action: 'CANCEL_REQUEST',
      };
    }
  }

  // ── Supplier Queries ──
  if (userRole === 'supplier') {
    if (text.includes('order')) {
      return {
        reply: isEnglish
          ? `Your store currently has ${context.totalOrders || 0} total orders. New orders alert your dashboard with a live sound. Please accept orders within 2 minutes to allocate a delivery partner.`
          : `Aapki dukaan ke kul ${context.totalOrders || 0} orders hain. Naye orders dashboard par live sound ke sath aate hain. Kripya naye orders ko 2 minute mein accept karein taaki delivery partner assign ho sake.`,
        action: null,
      };
    }
    if (text.includes('settlement') || text.includes('payment') || text.includes('payout')) {
      return {
        reply: isEnglish
          ? `Your current available balance is ₹${context.pocketBalance || 0}. Completed order settlements are transferred to your registered bank account. Use the Earnings tab to view details.`
          : `Aapka current available balance ₹${context.pocketBalance || 0} hai. Approved deliveries ka settlement direct aapke registered bank/UPI account mein bhej diya jata hai. Withdraw karne ke liye Earnings tab ka use karein.`,
        action: null,
      };
    }
    if (text.includes('out of stock') || text.includes('band') || text.includes('item')) {
      return {
        reply: isEnglish
          ? 'To mark an item Out of Stock: Go to Store Dashboard -> Menu / Catalog -> Toggle the item switch to OFF. It will immediately stop appearing to customers.'
          : 'Kisi item ko Out of Stock karne ke liye: Store Dashboard -> Menu / Catalog -> Item ke toggle button ko OFF kar dein. Isse customer ko woh item dikhna turant band ho jayega.',
        action: null,
      };
    }
  }

  // ── Rider Queries ──
  if (userRole === 'rider') {
    if (text.includes('active') || text.includes('delivery') || text.includes('order')) {
      if (!context.activeDelivery) {
        return {
          reply: isEnglish
            ? 'You currently have no active deliveries. Stay online near a hotspot area to receive new order assignments.'
            : 'Abhi aapki koi active delivery nahi hai. Online rahein aur hotspot area ke paas rahein, naya order aane par screen par notification aayega.',
          action: null,
        };
      }
      const d = context.activeDelivery;
      return {
        reply: isEnglish
          ? `Active Delivery: Order #${d.bookingId}. Store: ${d.restaurantName || 'Restaurant'}. Customer: ${d.customerFirstName || 'Customer'}. Status: ${d.status}. Navigation route is displayed live on your map.`
          : `Active Delivery: Order #${d.bookingId}. Store: ${d.restaurantName || 'Restaurant'}. Customer: ${d.customerFirstName || 'Customer'}. Status: ${d.status}. Route map screen par live dikhaya ja raha hai.`,
        action: null,
      };
    }

    if (text.includes('customer') && (text.includes('phone') || text.includes('mil nahi') || text.includes('unreachable'))) {
      return {
        reply: isEnglish
          ? 'Upon reaching the customer location, please attempt to call the customer 3 times via the app. If there is no response within 10 minutes, raise a ticket with the support team.'
          : 'Customer ke delivery location par pahunchne ke baad app se 3 baar call karein. Agar 10 minute tak koi response nahi milta hai, to Support Team ko ticket raise karein. Cancel karne se pehle support manzoori zaroori hai.',
        action: 'TRANSFER_SUPPORT',
      };
    }

    if (text.includes('delay') || text.includes('ready nahi') || text.includes('waiting')) {
      return {
        reply: isEnglish
          ? 'If the order is not ready at the store, share the booking ID with the store manager. If delayed over 15 minutes, you may request a zero-penalty re-assignment from support.'
          : 'Agar restaurant par order ready nahi hai, to store manager ko booking ID batayein. 15 minute se zyada der hone par aap 0-penalty order re-assign ka anurodh support se kar sakte hain.',
        action: null,
      };
    }

    if (text.includes('kamai') || text.includes('earning') || text.includes('pocket')) {
      return {
        reply: isEnglish
          ? `Your current Pocket Balance is: ₹${context.pocketBalance || 0}. Today's trips and incentives are displayed in your Pocket tab.`
          : `Aapka Vartamaan Pocket Balance: ₹${context.pocketBalance || 0}. Aaj ke trips aur incentives Pocket tab mein live dikhte hain. Cash limit safe rakhne ke liye time par deposit karein.`,
        action: null,
      };
    }
  }

  // Default natural human-like response
  return {
    reply: isEnglish
      ? `Hello ${salutationEnglish}! Welcome to Ride Hub Support. How can I assist you today? Feel free to ask any question regarding orders, payments, or stores!`
      : `नमस्ते ${salutationHindi}! Ride Hub में आपका स्वागत है। बताइए, मैं आपकी क्या सहायता कर सकता हूँ? आप किसी भी सवाल के लिए पूछ सकते हैं!`,
    action: null,
  };
}

// ── Call External LLM (Gemini / OpenRouter) ───────────────────
async function callLLMService(systemPrompt, userMessages) {
  const apiKey = aiConfig.apiKey;
  if (!apiKey) {
    return null; // Will trigger smart rule-based fallback
  }

  try {
    if (aiConfig.provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.geminiModel}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: userMessages.map(m => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }],
        })),
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 600,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
    } else if (aiConfig.provider === 'openrouter') {
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const messages = [
        { role: 'system', content: systemPrompt },
        ...userMessages.map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text,
        }))
      ];

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.openrouterModel,
          messages,
          temperature: 0.5,
          max_tokens: 600,
        }),
      });

      const data = await response.json();
      if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }
    }
  } catch (err) {
    console.warn('[AI Support Controller] LLM Call Error, falling back to smart engine:', err.message);
  }
  return null;
}

// ── Controller: Chat with Agent ──────────────────────────────
exports.chatWithAgent = async (req, res) => {
  try {
    const authUser = req.user;
    const bodyUserId = req.body.userId;
    const resolvedUserId = (authUser?._id || authUser?.id || bodyUserId || 'guest_user').toString();
    const resolvedRole = (authUser?.role || req.body.role || 'customer').toLowerCase();

    // Resolve real user name from auth or MongoDB
    let resolvedUserName = authUser?.name || req.body.userName;
    if (!resolvedUserName || resolvedUserName === 'User' || resolvedUserName === 'Customer' || resolvedUserName === 'guest_user') {
      try {
        if (resolvedUserId && resolvedUserId !== 'guest_user' && resolvedUserId.length === 24) {
          const dbUser = await User.findById(resolvedUserId).select('name fullName firstName').lean();
          if (dbUser?.name || dbUser?.fullName || dbUser?.firstName) {
            resolvedUserName = dbUser.name || dbUser.fullName || dbUser.firstName;
          }
        }
      } catch (_) {}
    }
    const userName = (resolvedUserName || 'User').trim();
    const message = (req.body.message || '').trim();
    const sessionId = req.body.sessionId || `session_${resolvedUserId}_${Date.now()}`;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    // 1. Enforce Daily Message Limit
    const todayStr = new Date().toISOString().split('T')[0];
    let chatLog = await AIChatLog.findOne({ userId: resolvedUserId, sessionId });

    if (!chatLog) {
      chatLog = new AIChatLog({
        userId: resolvedUserId,
        userRole: resolvedRole,
        userName,
        sessionId,
        messages: [],
        dailyMessageCount: 0,
        lastMessageDate: todayStr,
      });
    }

    // Count today's messages for rate limiting
    const todayLogs = await AIChatLog.find({ userId: resolvedUserId, lastMessageDate: todayStr });
    const totalTodayMessages = todayLogs.reduce((sum, l) => sum + (l.messages?.filter(m => m.sender === 'user').length || 0), 0);

    if (totalTodayMessages >= aiConfig.dailyMessageLimit) {
      return res.status(429).json({
        success: false,
        message: `Aapki aaj ki AI message seema (${aiConfig.dailyMessageLimit}) poori ho gayi hai. Kisi bhi aapat ya jaroori madad ke liye direct Support Team se judein.`,
        actionSuggestion: 'TRANSFER_SUPPORT',
      });
    }

    // 2. Fetch Real Dynamic Context based on Role
    let contextData = { role: resolvedRole, userId: resolvedUserId, userName };

    if (resolvedRole === 'customer') {
      // Find current active order (strictly in active running statuses within last 24h)
      const activeOrder = await Booking.findOne({
        $or: [
          { customerId: resolvedUserId },
          { customerPhone: authUser?.phoneNumber || undefined },
        ].filter(Boolean),
        status: { $in: ACTIVE_ORDER_STATUSES },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }).sort({ createdAt: -1 }).lean();

      contextData.hasActiveOrder = !!activeOrder;
      contextData.hasOrders = !!activeOrder;
      if (activeOrder) {
        contextData.latestOrder = {
          bookingId: activeOrder.bookingId,
          status: activeOrder.status,
          serviceName: activeOrder.serviceName || activeOrder.categoryName,
          restaurantName: activeOrder.restaurantName || 'Store Partner',
          price: activeOrder.price,
          createdAt: activeOrder.createdAt,
        };
      } else {
        contextData.latestOrder = null;
      }

      // Online restaurants from real MongoDB database
      const onlineSuppliers = await User.find({
        role: 'supplier',
        $or: [{ isOnline: true }, { restaurant_status: 'online' }]
      }).select('name restaurantName categoryName businessType').limit(10).lean();

      contextData.onlineStores = onlineSuppliers.map(s => ({
        name: s.restaurantName || s.name || 'Store',
        category: s.categoryName || s.businessType || 'Food',
      }));
    } else if (resolvedRole === 'supplier') {
      const orders = await Booking.find({
        $or: [
          { restaurantId: resolvedUserId },
          { supplierId: resolvedUserId },
          { partnerId: resolvedUserId },
        ]
      }).sort({ createdAt: -1 }).limit(10).lean();

      contextData.totalOrders = orders.length;
      contextData.pendingOrders = orders.filter(o => o.status === 'PENDING' || o.status === 'BOOKING_REQUESTED').length;
      contextData.pocketBalance = authUser?.pocketBalance || 0;
    } else if (resolvedRole === 'rider') {
      const activeDelivery = await Booking.findOne({
        $or: [
          { riderId: resolvedUserId },
          { 'acceptedBy.riderId': resolvedUserId },
        ],
        status: { $in: ['ACCEPTED_BY_RIDER', 'REACHED_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FOOD_PICKED_UP'] }
      }).lean();

      if (activeDelivery) {
        const rawCustName = (activeDelivery.customerName || 'Customer').trim();
        const firstName = rawCustName.split(' ')[0] + (rawCustName.split(' ').length > 1 ? ` ${rawCustName.split(' ')[1][0]}.` : '');
        contextData.activeDelivery = {
          bookingId: activeDelivery.bookingId,
          restaurantName: activeDelivery.restaurantName || 'Restaurant',
          customerFirstName: firstName,
          status: activeDelivery.status,
          destinationAddress: activeDelivery.destinationAddress || activeDelivery.serviceAddress || 'Drop Location',
        };
      } else {
        contextData.activeDelivery = null;
      }
      contextData.pocketBalance = authUser?.pocketBalance || 0;
    }

    const hasValidName = userName && userName !== 'User' && userName !== 'Customer' && userName !== 'Guest';
    const userSalutation = hasValidName ? `${userName} जी` : 'सर';

    // 3. Assemble Dynamic System Prompt for LLM
    const systemPrompt = `Tum Ride Hub multi-vendor application ke official, respectful aur helpful Human Support Executive ho.
Tumhara baat karne ka dhang bilkul ek samajhdaar, vinamra aur professional insaan (ChatGPT) jaisa natural aur warm hona chahiye.

RULES & CONVERSATION GUIDELINES:
1. User ka authenticated role: "${resolvedRole}". User name: "${userName}".
   - Agar user ka asli naam pata hai (${userSalutation}), to vinamrata se "नमस्ते ${userSalutation}!" bolkar baat karo.
   - Agar naam nahi hai ya generic hai, to "Hello sir! Welcome to Ride Hub. How can I help you today?" ya "नमस्ते सर! Ride Hub में आपका स्वागत है। बताइए, मैं आपकी क्या मदद कर सकता हूँ?" bolo.
2. User ke har sawal ka jawab ek asli insaan ki tarah naturally do. Khali cold bullet points mat phenko, pehle unki baat samjho aur natural conversational tone mein madad karo.
3. User jab 'Hi', 'Hello', ya greeting kare:
   - "Hello sir! Welcome to Ride Hub. How can I help you today?" ya "नमस्ते ${userSalutation}! Ride Hub में आपका स्वागत है। बताइए, आज मैं आपकी क्या सहायता कर सकता हूँ?"
4. User jab kahe 'mujhe order karna hai' ya 'order place karna hai':
   - "बिल्कुल ${userSalutation}! मैं आपकी मदद करता हूँ। सबसे पहले अपनी पसंद की कैटेगरी (Food, Fashion, Grocery) चुनिए, फिर स्टोर और प्रोडक्ट चुनकर कार्ट में जोड़िए। उसके बाद अपना डिलीवरी एड्रेस चुनें और उपलब्ध पेमेंट विकल्प (UPI, Cards, Cash on Delivery) से ऑर्डर कन्फर्म करें। आप किस कैटेगरी से ऑर्डर करना चाहते हैं?"
5. LANGUAGE MATCHING RULE (STRICT):
   - Agar user English mein likhe (e.g. "Hi", "Hello", "I want to order", "How to order", "Where is my order", "Refund policy", "Thanks") -> Reply 100% in fluent, polite, professional English!
   - Agar user Hindi ya Hinglish mein likhe (e.g. "नमस्ते", "Order kaise karein", "Mera order kahan hai", "Mujhe order karna hai", "Dhanyawad") -> Reply 100% in respectful, natural Hindi / Hinglish!
   - Kabhi bhi language mismatch mat karo. User jis bhasha mein shuru kare, usi mein continue karo.
6. Real Data Context:
${JSON.stringify(contextData, null, 2)}
7. Agar customer ka koi ACTIVE order nahi chal raha hai (hasActiveOrder: false), to unhe saaf bolo ki "Abhi aapka koi active order nahi chal raha hai". KISI BHI DUMMY YA MAN-GHADANT ORDER KI JAANKARI KABHI NA DEIN. Aise customer ke liye "Order kaise place karein", "Payment ke tareeke", "Refund aur cancellation policy" ya "Kaun se store online khule hain" mein sahayata karein.
8. Online restaurant / store poochhne par sirf context mein diye gaye onlineStores ke asli naam batao. Agar list khali hai to saaf bolo "Abhi koi store online nahi hai", apni taraf se naam mat banao.
9. Cancel Niyam: Food order restaurant prepare shuru karne ke baad cancel par 0% refund. Fashion/other mein delivery fee chhodkar poora product price refund.
10. Rider context: Purani rides ka customer data poori tarah confidential hai. Chalti delivery mein sirf first name dikhao.
11. Tum khud database mein cancel ya refund trigger nahi kar sakte. Support request ka option do.`;

    // 4. Try LLM first; if null, use Smart Fallback Engine
    const previousMessages = chatLog.messages.slice(-6);
    let finalReply = await callLLMService(systemPrompt, [...previousMessages, { sender: 'user', text: message }]);
    let suggestedAction = null;

    if (!finalReply) {
      const fallbackResult = generateSmartFallbackResponse(resolvedRole, message, contextData);
      finalReply = fallbackResult.reply;
      suggestedAction = fallbackResult.action;
    } else {
      // Detect if reply contains cancel or support suggestions
      const lower = finalReply.toLowerCase();
      if (lower.includes('cancel request') || lower.includes('cancel karne ke liye')) {
        suggestedAction = 'CANCEL_REQUEST';
      } else if (lower.includes('support team') || lower.includes('ticket')) {
        suggestedAction = 'TRANSFER_SUPPORT';
      }
    }

    // 5. Save Conversation in MongoDB
    chatLog.messages.push({
      sender: 'user',
      text: message,
      timestamp: new Date(),
    });
    chatLog.messages.push({
      sender: 'agent',
      text: finalReply,
      timestamp: new Date(),
      actionSuggested: suggestedAction,
    });
    chatLog.dailyMessageCount += 1;
    chatLog.lastMessageDate = todayStr;
    await chatLog.save();

    return res.status(200).json({
      success: true,
      reply: finalReply,
      sessionId,
      actionSuggestion: suggestedAction,
      remainingLimit: Math.max(0, aiConfig.dailyMessageLimit - (totalTodayMessages + 1)),
    });
  } catch (error) {
    console.error('[AI Support Controller Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'AI agent is temporarily busy. Please contact human support.',
      actionSuggestion: 'TRANSFER_SUPPORT',
    });
  }
};

// ── Controller: Submit Thumbs Up / Thumbs Down Feedback ──────
exports.submitFeedback = async (req, res) => {
  try {
    const { sessionId, messageIndex, feedback } = req.body;
    if (!sessionId || !feedback) {
      return res.status(400).json({ success: false, message: 'Invalid feedback parameters' });
    }

    const chatLog = await AIChatLog.findOne({ sessionId });
    if (!chatLog) {
      return res.status(404).json({ success: false, message: 'Chat session not found' });
    }

    if (messageIndex !== undefined && chatLog.messages[messageIndex]) {
      chatLog.messages[messageIndex].feedback = feedback;
    } else {
      // Default to last agent message
      for (let i = chatLog.messages.length - 1; i >= 0; i--) {
        if (chatLog.messages[i].sender === 'agent') {
          chatLog.messages[i].feedback = feedback;
          break;
        }
      }
    }

    await chatLog.save();
    return res.status(200).json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    console.error('[AI Feedback Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to record feedback' });
  }
};

// ── Controller: Get Role-specific Quick Buttons ──────────────
exports.getQuickButtons = async (req, res) => {
  try {
    const role = (req.query.role || req.user?.role || 'customer').toLowerCase();
    const userId = (req.query.userId || req.user?._id || req.user?.id || '').toString();

    if (role === 'customer') {
      // Check if user currently has an ACTIVE running order
      const activeOrder = await Booking.findOne({
        $or: [{ customerId: userId }, { customerPhone: req.user?.phoneNumber || undefined }].filter(Boolean),
        status: { $in: ACTIVE_ORDER_STATUSES },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }).lean();

      const buttons = activeOrder ? QUICK_BUTTONS.customer_active_orders : QUICK_BUTTONS.customer_no_orders;
      return res.status(200).json({ success: true, buttons, hasActiveOrder: !!activeOrder });
    } else if (role === 'supplier') {
      return res.status(200).json({ success: true, buttons: QUICK_BUTTONS.supplier });
    } else if (role === 'rider') {
      return res.status(200).json({ success: true, buttons: QUICK_BUTTONS.rider });
    }
    return res.status(200).json({ success: true, buttons: QUICK_BUTTONS.customer_no_orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── Controller: Create Support Ticket / Cancel Request from AI ──
exports.createSupportTicketFromAI = async (req, res) => {
  try {
    const { orderRef, issueCategory, description, type } = req.body;
    const authUser = req.user;
    const userId = (authUser?._id || authUser?.id || req.body.userId || 'anon_user').toString();
    const role = (authUser?.role || req.body.role || 'customer').toLowerCase();

    const newTicket = await SupportCase.create({
      orderRef: orderRef || '',
      bookingId: orderRef || '',
      category: type === 'CANCEL_REQUEST' ? 'cancellation' : (issueCategory || 'General'),
      issueCategory: type === 'CANCEL_REQUEST' ? 'Order Cancellation Request' : (issueCategory || 'AI Escalation'),
      issueTitle: type === 'CANCEL_REQUEST' ? `Cancel Request for Order #${orderRef || 'N/A'}` : 'Escalated from AI Agent',
      description: description || `Ticket created from AI Support Agent by ${role}`,
      priority: type === 'CANCEL_REQUEST' ? 'high' : 'normal',
      requesterRole: role === 'supplier' ? 'supplier' : (role === 'rider' ? 'rider' : 'customer'),
      requesterRef: userId,
      requesterName: authUser?.name || 'User',
      requesterPhone: authUser?.phoneNumber || '',
      status: 'OPEN',
    });

    // Notify Support Team / Admin via Socket.IO
    try {
      const _io = req.app.get('io') || global.io;
      if (_io) {
        _io.emit('support_ticket_created', newTicket);
        _io.to('support_agents').emit('new_support_case', newTicket);
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: 'Support ticket successfully created. Our support team will review it immediately.',
      ticketId: newTicket.ticketId,
      caseNumber: newTicket.caseNumber,
    });
  } catch (error) {
    console.error('[AI Ticket Creation Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to create support ticket' });
  }
};
