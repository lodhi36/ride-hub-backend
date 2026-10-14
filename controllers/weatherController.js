const https = require('https');
const http = require('http');

// Helper to make HTTP/HTTPS GET requests
const fetchJson = (url, headers = {}) => {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'AntigravityApp/1.0', ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
};

const getWeather = async (req, res, next) => {
  try {
    const latStr = req.query.lat;
    const lonStr = req.query.lon;

    if (!latStr || !lonStr || isNaN(parseFloat(latStr)) || isNaN(parseFloat(lonStr))) {
      return res.status(400).json({
        success: false,
        message: 'Valid lat and lon query parameters are required from device GPS',
      });
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    const primaryKey = '63a8614925f34ff75b83d55345eda4e8';
    const fallbackKey = 'ecedcdee76bfae83fb4ac3899ba3bd05';
    const openWeatherApiKey = process.env.OPENWEATHER_API_KEY || primaryKey;

    // 1. Primary: OpenWeather API via Exact Coordinates
    let owData = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${openWeatherApiKey}&units=metric`);
    if (!owData || !owData.main) {
      // If primary key is in activation period or returns error, try fallback key
      owData = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${fallbackKey}&units=metric`);
    }

    if (owData && owData.main && owData.weather && owData.weather.length > 0) {
        const temp = Math.round(owData.main.temp);
        const feels_like = Math.round(owData.main.feels_like ?? owData.main.temp);
        const mainCondition = owData.weather[0].main || 'Clear';
        const weatherId = owData.weather[0].id || 800;
        const condition = owData.weather[0].description
          ? owData.weather[0].description.charAt(0).toUpperCase() + owData.weather[0].description.slice(1)
          : mainCondition;
        const city = owData.name || '';
        const country = owData.sys?.country || '';

        // Check if Admin has manually enabled Rain Mode
        const AdminSettings = require('../models/AdminSettings');
        let adminRainActive = false;
        try {
          const settings = await AdminSettings.findOne().lean();
          if (settings && settings.rainMode && settings.rainMode.isActive) {
            adminRainActive = true;
          }
        } catch (e) {}

        // Check live ground precipitation from high-precision radar sensors (Open-Meteo)
        let livePrecipMm = 0;
        try {
          const meteoLive = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,rain,showers,weather_code`);
          if (meteoLive && meteoLive.current) {
            livePrecipMm = Number(meteoLive.current.precipitation || meteoLive.current.rain || 0);
          }
        } catch (e) {}

        // Strict Rain Condition: Admin Override OR Live Ground Precipitation > 0.1 mm
        const isRain = adminRainActive || (livePrecipMm > 0.1);

        const cloudsPercent = owData.clouds?.all ?? 0;
        let icon = '☀️';
        let displayCondition = 'Clear Sky';
        let displayMain = 'Clear';

        if (isRain) {
          displayCondition = condition.toLowerCase().includes('rain') ? condition : 'Rain';
          displayMain = 'Rain';
          icon = (weatherId >= 200 && weatherId < 300) ? '🌩️' : '🌧️';
        } else if (weatherId >= 600 && weatherId < 700) {
          displayCondition = 'Snow';
          displayMain = 'Snow';
          icon = '❄️';
        } else if (weatherId >= 700 && weatherId < 800) {
          displayCondition = 'Haze / Mist';
          displayMain = 'Mist';
          icon = '🌫️';
        } else {
          // Accurate Sky Condition based on clouds
          if (cloudsPercent < 20) {
            displayCondition = 'Clear Sky';
            displayMain = 'Clear';
            icon = '☀️';
          } else if (cloudsPercent < 65) {
            displayCondition = 'Partly Cloudy';
            displayMain = 'Clouds';
            icon = '⛅';
          } else {
            displayCondition = 'Overcast Clouds';
            displayMain = 'Clouds';
            icon = '☁️';
          }
        }

        // Fetch locality state via Nominatim if needed
        let state = '';
        let locationName = city ? `${city}${country ? `, ${country}` : ''}` : '';
        try {
          const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
          const geoData = await fetchJson(geoUrl);
          if (geoData && geoData.address) {
            const localCity =
              geoData.address.city ||
              geoData.address.town ||
              geoData.address.village ||
              geoData.address.suburb ||
              geoData.address.state_district ||
              city;
            state = geoData.address.state || '';
            if (localCity && state) {
              locationName = `${localCity}, ${state}`;
            } else if (localCity) {
              locationName = localCity;
            }
          }
        } catch (err) {}

        return res.status(200).json({
          success: true,
          temp,
          feels_like,
          condition: displayCondition,
          mainCondition: displayMain,
          weatherId: isRain ? weatherId : (weatherId > 800 ? weatherId : 800),
          isRain,
          icon,
          city: city || locationName,
          state,
          locationName,
          clouds: owData.clouds?.all || 0,
          humidity: owData.main.humidity || 0,
          timestamp: new Date().toISOString(),
          source: 'OpenWeather',
        });
      }

    // 2. Fallback: Open-Meteo API
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const meteoData = await fetchJson(meteoUrl);

    if (meteoData && meteoData.current_weather) {
      const temp = Math.round(meteoData.current_weather.temperature);
      const code = meteoData.current_weather.weathercode;
      let condition = 'Clear Sky';
      let mainCondition = 'Clear';
      let icon = '☀️';
      let isRain = false;

      if (code === 0) {
        condition = 'Clear Sky';
        mainCondition = 'Clear';
        icon = '☀️';
      } else if (code >= 1 && code <= 3) {
        condition = 'Partly Cloudy';
        mainCondition = 'Clouds';
        icon = '⛅';
      } else if (code === 45 || code === 48) {
        condition = 'Foggy';
        mainCondition = 'Mist';
        icon = '🌫️';
      } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
        condition = code >= 61 ? 'Rain' : 'Drizzle';
        mainCondition = 'Rain';
        icon = '🌧️';
        isRain = true;
      } else if (code >= 95) {
        condition = 'Thunderstorm';
        mainCondition = 'Thunderstorm';
        icon = '🌩️';
        isRain = true;
      } else if (code >= 71 && code <= 77) {
        condition = 'Snow';
        mainCondition = 'Snow';
        icon = '❄️';
      }

      let locationName = `GPS (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
      try {
        const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
        const geoData = await fetchJson(geoUrl);
        if (geoData && geoData.address) {
          const localCity =
            geoData.address.city ||
            geoData.address.town ||
            geoData.address.village ||
            geoData.address.suburb ||
            geoData.address.state_district;
          const state = geoData.address.state || '';
          locationName = localCity && state ? `${localCity}, ${state}` : localCity || locationName;
        }
      } catch (e) {}

      console.log(`[WEATHER API] OPEN-METEO FALLBACK (${lat}, ${lon}) -> ${temp}°C, ${condition}, isRain: ${isRain}, Location: ${locationName}`);

      return res.json({
        success: true,
        temp,
        feels_like: temp,
        condition,
        mainCondition,
        weatherId: code,
        isRain,
        icon,
        locationName,
        timestamp: new Date().toISOString(),
        source: 'Open-Meteo',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Weather service unavailable for provided coordinates',
    });
  } catch (error) {
    console.error('[WEATHER API ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve weather data',
    });
  }
};

module.exports = { getWeather };
