const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TARGET_SIZE_BYTES = 50 * 1024; // 50KB

/**
 * Compress a single image file to under 50KB using iterative JPEG quality reduction.
 * @param {string} filePath - Absolute path to the uploaded image file
 */
const compressImageTo50KB = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);

  // If already under 50KB, no compression needed
  if (stats.size <= TARGET_SIZE_BYTES) return;

  let quality = 80;
  const minQuality = 5;
  const step = 10;

  while (quality >= minQuality) {
    const tempPath = filePath + '.tmp';

    try {
      let sharpInstance = sharp(filePath).resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      });

      // Always convert to JPEG for better compression
      await sharpInstance
        .jpeg({ quality, mozjpeg: true })
        .toFile(tempPath);

      const tempStats = fs.statSync(tempPath);

      if (tempStats.size <= TARGET_SIZE_BYTES) {
        // Replace original with compressed version
        fs.renameSync(tempPath, filePath);
        console.log(`[ImageCompress] Compressed to ${Math.round(tempStats.size / 1024)}KB at quality=${quality}`);
        return;
      } else {
        // Still too large, try lower quality
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        quality -= step;
      }
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    }
  }

  // Last resort: absolute minimum quality
  const tempPath = filePath + '.tmp';
  await sharp(filePath)
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 1, mozjpeg: true })
    .toFile(tempPath);

  fs.renameSync(tempPath, filePath);
  console.log('[ImageCompress] Applied maximum compression (quality=1)');
};

/**
 * Middleware: After multer saves files, compress all uploaded images to ≤50KB
 */
const autoCompressImages = async (req, res, next) => {
  try {
    if (!req.files) return next();

    const allFiles = [];

    // Collect all uploaded files from req.files (can be object or array)
    if (Array.isArray(req.files)) {
      allFiles.push(...req.files);
    } else {
      Object.values(req.files).forEach(fileArray => {
        if (Array.isArray(fileArray)) allFiles.push(...fileArray);
      });
    }

    // Compress each file
    await Promise.all(
      allFiles.map(async (file) => {
        try {
          await compressImageTo50KB(file.path);
          // Update file size in req object after compression
          const stats = fs.statSync(file.path);
          file.size = stats.size;
        } catch (err) {
          console.error(`[ImageCompress] Failed to compress ${file.filename}:`, err.message);
          // Don't block upload if compression fails
        }
      })
    );

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = autoCompressImages;
