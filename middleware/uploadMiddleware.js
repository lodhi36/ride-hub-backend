const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Use memoryStorage so we can pipe through sharp for compression
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|jfif|avif|heic|heif|gif|svg|mp3|wav|m4a|aac/i;
  const originalName = file.originalname || 'unknown.jpg';
  const extname = allowedTypes.test(path.extname(originalName).toLowerCase());
  
  let mimetype = false;
  if (file.mimetype) {
    mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/');
  }

  if (extname || mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only images and audio files are allowed!'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max raw upload
  }
});

const compressImage = async (req, res, next) => {
  try {
    const filesToProcess = [];

    if (req.file) {
      filesToProcess.push({ field: 'single', file: req.file });
    } else if (req.files) {
      if (Array.isArray(req.files)) {
        req.files.forEach(f => filesToProcess.push({ field: 'array', file: f }));
      } else {
        Object.keys(req.files).forEach(fieldName => {
          req.files[fieldName].forEach(f =>
            filesToProcess.push({ field: fieldName, file: f })
          );
        });
      }
    }

    if (filesToProcess.length === 0) {
      console.log('No files to process in compressImage middleware');
    }

    for (const item of filesToProcess) {
      const { file } = item;
      if (!file || !file.buffer) {
        console.log('Skipping file: missing buffer');
        continue;
      }

      const mime = file.mimetype || 'image/jpeg';
      const isAudio = mime.startsWith('audio/') || (file.originalname && file.originalname.match(/\.(mp3|wav|m4a|aac)$/i));
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const filename = `${file.fieldname}-${uniqueSuffix}${isAudio ? path.extname(file.originalname || '.mp3') : '.jpg'}`;
      const outputPath = path.join(uploadDir, filename);

      let outputBuffer;
      let finalMimeType = mime;

      if (isAudio) {
        outputBuffer = file.buffer;
      } else {
        let quality = 80;
        try {
          do {
            outputBuffer = await sharp(file.buffer)
              .rotate()
              .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality, progressive: true })
              .toBuffer();
            quality -= 10;
          } while (outputBuffer.length > 50 * 1024 && quality > 10);
          finalMimeType = 'image/jpeg';
        } catch (sharpError) {
          console.error('Sharp processing error:', sharpError);
          // Fallback to saving original buffer if sharp fails
          outputBuffer = file.buffer;
          console.log('Falling back to uncompressed image due to sharp error.');
        }
      }

      fs.writeFileSync(outputPath, outputBuffer);

      file.filename = filename;
      file.path = outputPath;
      file.size = outputBuffer.length;
      file.mimetype = finalMimeType;
    }

    next();
  } catch (err) {
    console.error('compressImage fatal error:', err);
    next(err);
  }
};

module.exports = { upload, compressImage };
