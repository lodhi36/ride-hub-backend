try {
  require('./sockets/socketHandler');
  require('./controllers/liveController');
  require('./controllers/authController');
  require('./controllers/menuController');
  console.log('All tested controllers compiled successfully');
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
