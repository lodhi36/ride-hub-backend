const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputImagePath = "C:\\Users\\pc\\.gemini\\antigravity-ide\\brain\\91a37081-4154-4714-8a16-b9be211b4e72\\dating_app_icon_1781594386628.png";
const androidResPath = path.resolve(__dirname, '../DatingApp/android/app/src/main/res');

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function generateIcons() {
  try {
    for (const [folder, size] of Object.entries(sizes)) {
      const folderPath = path.join(androidResPath, folder);
      
      // Ensure folder exists
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      // Generate ic_launcher.png
      await sharp(inputImagePath)
        .resize(size, size)
        .png()
        .toFile(path.join(folderPath, 'ic_launcher.png'));

      // Generate ic_launcher_round.png (creating a circle mask)
      const circleSvg = `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" /></svg>`;
      const circleMask = Buffer.from(circleSvg);
      
      await sharp(inputImagePath)
        .resize(size, size)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toFile(path.join(folderPath, 'ic_launcher_round.png'));

      console.log(`Generated icons for ${folder} (${size}x${size})`);
    }
    console.log("App Icons generated successfully!");
  } catch (err) {
    console.error("Error generating icons:", err);
  }
}

generateIcons();
