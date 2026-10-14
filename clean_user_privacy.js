require('dotenv').config({ path: 'C:/Users/pc/Downloads/datin/datin/backend 3/.env' });
const mongoose = require('mongoose');
const User = require('C:/Users/pc/Downloads/datin/datin/backend 3/models/User');

const uri = process.env.MONGODB_URI;

mongoose.connect(uri).then(async () => {
  console.log('Connected to Atlas MongoDB');

  // 1. Clean up Customers
  const customerResult = await User.updateMany(
    { role: { $in: ['customer', 'user', 'client'] } },
    {
      $unset: {
        restaurantName: 1,
        partnerType: 1,
        businessType: 1,
        business_type: 1,
        businessCategoryId: 1,
        businessCategoryName: 1,
        categoryName: 1,
        restaurant_status: 1,
      }
    }
  );
  console.log('Cleaned up customers:', customerResult);

  // 2. Clean up Riders
  const riderResult = await User.updateMany(
    { role: { $in: ['rider', 'delivery_partner', 'driver'] } },
    {
      $unset: {
        restaurantName: 1,
        partnerType: 1,
        businessType: 1,
        business_type: 1,
        businessCategoryId: 1,
        businessCategoryName: 1,
        categoryName: 1,
        restaurant_status: 1,
      }
    }
  );
  console.log('Cleaned up riders:', riderResult);

  // 3. Clean up Admins
  const adminResult = await User.updateMany(
    { role: 'admin' },
    {
      $unset: {
        restaurantName: 1,
        partnerType: 1,
        businessType: 1,
        business_type: 1,
      }
    }
  );
  console.log('Cleaned up admins:', adminResult);

  // 4. Verify list of remaining suppliers / stores
  const stores = await User.find({
    role: { $in: ['supplier', 'restaurant', 'seller_partner', 'merchant', 'store', 'Supplier', 'Restaurant', 'Seller'] }
  }).select('name restaurantName role categoryName isOnline approvalStatus').lean();

  console.log(`\nVerified ${stores.length} REAL Stores/Restaurants in DB:`);
  stores.forEach((s, i) => {
    console.log(`${i + 1}. [${s.role}] "${s.restaurantName || s.name}" (isOnline: ${s.isOnline})`);
  });

  process.exit(0);
}).catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
