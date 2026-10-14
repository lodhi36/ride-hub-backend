const TermsAndConditions = require('../models/TermsAndConditions');
const User = require('../models/User');
const { getClientIp } = require('../utils/ipUtils');

// Get active terms for a role (customer, rider, supplier)
exports.getTermsByRole = async (req, res) => {
  try {
    let { role } = req.params;
    if (!role) role = 'customer';
    role = role.toLowerCase().trim();

    // Map alternative role strings
    if (role === 'delivery_partner' || role === 'provider') role = 'rider';
    if (role === 'restaurant' || role === 'seller_partner' || role === 'store') role = 'supplier';

    let terms = await TermsAndConditions.findOne({ role, isPublished: true });
    if (!terms) {
      // Seed default terms if none found
      await TermsAndConditions.seedDefaultTerms();
      terms = await TermsAndConditions.findOne({ role });
    }

    if (!terms) {
      return res.status(404).json({ success: false, message: `Terms not found for role: ${role}` });
    }

    return res.status(200).json({
      success: true,
      terms: {
        role: terms.role,
        version: terms.version,
        title: terms.title,
        description: terms.description,
        language: terms.language,
        publishedAt: terms.publishedAt,
        clauses: terms.clauses.sort((a, b) => (a.order || 0) - (b.order || 0)),
      },
    });
  } catch (error) {
    console.error('Error in getTermsByRole:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Accept & digitally sign Terms & Conditions
exports.acceptTerms = async (req, res) => {
  try {
    const { userId, role, signedName, clausesAccepted, version } = req.body;
    const clientIpInfo = getClientIp ? getClientIp(req) : { ipAddress: req.ip || '' };
    const ipAddress = clientIpInfo.ipAddress || req.ip || '127.0.0.1';

    const cleanSignedName = (signedName && signedName.trim()) || (req.user && (req.user.name || req.user.username)) || 'Verified User';

    let normalizedRole = (role || 'customer').toLowerCase().trim();
    if (normalizedRole === 'delivery_partner' || normalizedRole === 'provider') normalizedRole = 'rider';
    if (normalizedRole === 'restaurant' || normalizedRole === 'seller_partner' || normalizedRole === 'store') normalizedRole = 'supplier';

    // Verify clauses
    let termsDoc = await TermsAndConditions.findOne({ role: normalizedRole });
    if (!termsDoc) {
      await TermsAndConditions.seedDefaultTerms();
      termsDoc = await TermsAndConditions.findOne({ role: normalizedRole });
    }

    const mandatoryClauseIds = termsDoc ? termsDoc.clauses.filter(c => c.isMandatory).map(c => c.clauseId) : [];
    const userAcceptedSet = new Set(Array.isArray(clausesAccepted) ? clausesAccepted : []);

    const missingClauses = mandatoryClauseIds.filter(id => !userAcceptedSet.has(id));
    if (missingClauses.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'आगे बढ़ने के लिए सभी अनिवार्य नियमों को स्वीकार करना आवश्यक है।',
        missingClauses,
      });
    }

    const targetUserId = userId || (req.user && req.user._id);
    let user = null;
    if (targetUserId) {
      user = await User.findById(targetUserId);
    }

    const consentData = {
      accepted: true,
      version: version || (termsDoc ? termsDoc.version : '1.0'),
      acceptedAt: new Date(),
      signedName: cleanSignedName,
      ipAddress,
      clausesAccepted: Array.from(userAcceptedSet),
      role: normalizedRole,
    };

    if (user) {
      user.termsConsent = consentData;
      // Set approvalStatus based on role
      if (normalizedRole === 'customer') {
        user.approvalStatus = 'APPROVED';
      } else {
        // For rider / supplier, if they were PENDING_TERMS, advance to PENDING_VERIFICATION
        if (!user.approvalStatus || user.approvalStatus === 'PENDING_TERMS' || user.approvalStatus === 'PENDING') {
          user.approvalStatus = 'PENDING_VERIFICATION';
        }
      }
      await user.save();
    }

    // Save signature in TermsAndConditions audit trail
    if (termsDoc && user) {
      termsDoc.signatures.push({
        userId: user._id,
        userName: user.name || user.username || cleanSignedName,
        userPhone: user.phoneNumber || '',
        signedName: cleanSignedName,
        role: normalizedRole,
        ipAddress,
        version: consentData.version,
        clausesAccepted: consentData.clausesAccepted,
        acceptedAt: consentData.acceptedAt,
      });
      await termsDoc.save();
    }

    // Realtime notification to Admin tracking
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        io.to('admin_tracking').emit('terms_accepted_audit', {
          userId: targetUserId,
          role: normalizedRole,
          signedName: cleanSignedName,
          timestamp: new Date(),
        });
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: 'नियम एवं शर्तें सफलतापूर्वक स्वीकार की गईं। (Terms accepted successfully)',
      termsConsent: consentData,
      user: user ? {
        id: user._id,
        role: user.role,
        approvalStatus: user.approvalStatus,
        termsConsent: user.termsConsent,
      } : null,
    });
  } catch (error) {
    console.error('Error in acceptTerms:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Get all terms, clauses & signature audit trail
exports.adminGetAllTerms = async (req, res) => {
  try {
    let terms = await TermsAndConditions.find({}).lean();
    if (terms.length === 0) {
      await TermsAndConditions.seedDefaultTerms();
      terms = await TermsAndConditions.find({}).lean();
    }
    return res.status(200).json({ success: true, terms });
  } catch (error) {
    console.error('Error in adminGetAllTerms:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Update / Publish terms
exports.adminUpdateTerms = async (req, res) => {
  try {
    const { role } = req.params;
    const { title, description, clauses, version, isPublished } = req.body;

    const terms = await TermsAndConditions.findOneAndUpdate(
      { role: role.toLowerCase() },
      {
        ...(title && { title }),
        ...(description && { description }),
        ...(clauses && { clauses }),
        ...(version && { version }),
        ...(isPublished !== undefined && { isPublished }),
        publishedAt: new Date(),
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: `${role} terms updated successfully`,
      terms,
    });
  } catch (error) {
    console.error('Error in adminUpdateTerms:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
