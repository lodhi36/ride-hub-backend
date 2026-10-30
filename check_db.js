const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

mongoose.connect(uri).then(async () => {
  const items = await mongoose.connection.collection('menuitems').find({}).toArray();
  console.log('MenuItems count:', items.length);
  items.slice(0, 10).forEach(i => console.log('Item:', i.name, '| Store:', i.restaurantId, '| Img:', i.image));
  
  const rest = await mongoose.connection.collection('restaurants').find({}).toArray();
  console.log('Restaurants count:', rest.length);
  rest.forEach(r => console.log('Rest:', r.name || r.restaurantName, '| ID:', r._id, '| Cat:', r.categoryName));

  const screens = await mongoose.connection.collection('screenmedias').find({}).toArray();
  console.log('Total ScreenMedias count before dedup:', screens.length);
  
  // Group by screenId
  const byId = {};
  for (const s of screens) {
    if (!byId[s.screenId]) byId[s.screenId] = [];
    byId[s.screenId].push(s);
  }

  for (const sid of Object.keys(byId)) {
    const list = byId[sid];
    if (list.length > 1) {
      console.log(`Found ${list.length} records for ${sid}`);
      // Find the best record (one with imageUrl or lottieUrl)
      list.sort((a, b) => {
        const aScore = (a.imageUrl ? 10 : 0) + (a.lottieUrl ? 5 : 0) + (new Date(a.updatedAt || 0).getTime() / 1e12);
        const bScore = (b.imageUrl ? 10 : 0) + (b.lottieUrl ? 5 : 0) + (new Date(b.updatedAt || 0).getTime() / 1e12);
        return bScore - aScore;
      });
      const best = list[0];
      const toDelete = list.slice(1);
      for (const d of toDelete) {
        await mongoose.connection.collection('screenmedias').deleteOne({ _id: d._id });
        console.log(`Deleted duplicate for ${sid}: ${d._id}`);
      }
    }
  }

  const remaining = await mongoose.connection.collection('screenmedias').find({}).toArray();
  console.log('Total ScreenMedias count after dedup:', remaining.length);
  remaining.forEach(s => {
    console.log('ScreenId:', s.screenId, '| Image:', s.imageUrl, '| Lottie:', s.lottieUrl, '| Display:', s.displayMode);
  });

  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
