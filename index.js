require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const fs = require("fs");
const axios = require("axios");

const app = express();
app.use(express.json()); // Enable JSON parsing

// Load Firebase credentials correctly
const serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://surfspot-884c9.firebaseio.com",
});

// Surf locations
const locations = [
  { name: "Muizenberg", longitude: "18.471152", latitude: "-34.108856" },
  { name: "Strand", longitude: "18.828540", latitude: "-34.120811" },
  { name: "Kommetjie", longitude: "18.327791", latitude: "-34.136238" },
  { name: "Big Bay", longitude: "18.456511", latitude: "-33.794006" },
  { name: "Melkbosstrand", longitude: "18.440003", latitude: "-33.724069" },
];

// Check surf conditions
const checkSurfConditions = async () => {
  let bestLocations = [];

  for (const location of locations) {
    try {
      const response = await axios.get(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${location.latitude}&longitude=${location.longitude}&hourly=wave_height,wave_period&timezone=auto`
      );

      const surfData = response.data.hourly;
      const waveHeights = surfData.wave_height;
      const wavePeriods = surfData.wave_period;

      // Calculate average wave height & wave period
      const avgWaveHeight =
        waveHeights.reduce((sum, value) => sum + value, 0) / waveHeights.length;
      const avgWavePeriod =
        wavePeriods.reduce((sum, value) => sum + value, 0) / wavePeriods.length;

      console.log(
        `🌊 ${location.name}: Avg Wave Height: ${avgWaveHeight.toFixed(
          2
        )}m, Avg Wave Period: ${avgWavePeriod.toFixed(2)}s`
      );

      // Store locations with ideal surf conditions (Example: Wave height > 1.5m & Wave period > 10s)
      if (avgWaveHeight > 1.5 && avgWavePeriod > 10) {
        bestLocations.push({ name: location.name, avgWaveHeight, avgWavePeriod });
      }
    } catch (error) {
      console.error(`❌ Error fetching data for ${location.name}:`, error.message);
    }
  }

  // Sort locations by best wave height & wave period
  bestLocations.sort((a, b) => b.avgWaveHeight - a.avgWaveHeight || b.avgWavePeriod - a.avgWavePeriod);

  if (bestLocations.length > 0) {
    console.log("🏄 Best Surf Locations Today:", bestLocations.map((loc) => loc.name).join(", "));
    sendSurfNotifications(bestLocations);
  } else {
    console.log("No ideal surf conditions detected.");
  }
};

// Send push notifications
const sendSurfNotifications = async (bestLocations) => {
  try {
    const db = admin.firestore();
    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();

    let tokens = [];
    snapshot.forEach((doc) => {
      if (doc.data().fcmToken) {
        tokens.push(doc.data().fcmToken);
      }
    });

    if (tokens.length === 0) {
      console.log("❌ No FCM tokens found. No notifications sent.");
      return;
    }

    // Format message with top surf spots
    const locationNames = bestLocations.map((loc) => loc.name).join(", ");
    const message = {
      notification: {
        title: "🌊 Best Surf Spots Today!",
        body: `🏄‍♂️ Great conditions at: ${locationNames}. Time to surf!`,
      },
      tokens: tokens,
    };

    // Send notifications
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ Sent ${response.successCount} notifications.`);
  } catch (error) {
    console.error("❌ Error sending notifications:", error.message);
  }
};

// Run surf check every 20 seconds
setInterval(checkSurfConditions, 100000);

// Start server
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});