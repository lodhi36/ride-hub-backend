const User = require('../models/User');

// @desc    Get user settings
// @route   GET /api/settings
// @access  Private
const getSettings = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('theme notificationsEnabled privacyProfileVisible');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, settings: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user settings
// @route   PUT /api/settings
// @access  Private
const updateSettings = async (req, res, next) => {
  try {
    const { theme, notificationsEnabled, privacyProfileVisible } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (theme !== undefined) user.theme = theme;
    if (notificationsEnabled !== undefined) user.notificationsEnabled = notificationsEnabled;
    if (privacyProfileVisible !== undefined) user.privacyProfileVisible = privacyProfileVisible;

    await user.save();

    res.json({ 
      success: true, 
      settings: {
        theme: user.theme,
        notificationsEnabled: user.notificationsEnabled,
        privacyProfileVisible: user.privacyProfileVisible
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPublicSettings = async (req, res, next) => {
  try {
    const AdminSettings = require('../models/AdminSettings');
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({});
    }
    res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, updateSettings, getPublicSettings };
