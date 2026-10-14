const { body, validationResult } = require('express-validator');

const validateRegister = [
  body('email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('username')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3 }).withMessage('Username must be at least 3 characters long'),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 4 }).withMessage('Password must be at least 4 characters long'),
  (req, res, next) => {
    const hasPhone = req.body.phoneNumber || req.body.phone;
    const hasEmail = req.body.email;
    const hasUsername = req.body.username;
    if (!hasPhone && !hasEmail && !hasUsername) {
      return res.status(400).json({ success: false, message: 'Mobile number or email is required for registration' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }
    next();
  }
];

const validateLogin = [
  body('password')
    .notEmpty().withMessage('Password is required'),
  (req, res, next) => {
    const identifier = req.body.email || req.body.username || req.body.phoneNumber || req.body.phone;
    if (!identifier || !String(identifier).trim()) {
      return res.status(400).json({ success: false, message: 'Please provide mobile number, email, or username' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }
    next();
  }
];

module.exports = {
  validateRegister,
  validateLogin,
};
