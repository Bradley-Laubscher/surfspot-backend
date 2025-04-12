require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const fs = require("fs");
const axios = require("axios");

const app = express();
app.use(express.json()); // Enable JSON parsing

// Load Firebase credentials correctly
//const serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
let serviceAccount;

if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(
    fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")
  );
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
  }),
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
      const timestamps = surfData.time;

      let consecutiveHours = 0;
      let goodConditionDetected = false;

      for (let i = 0; i < timestamps.length; i++) {
        const hour = new Date(timestamps[i]).getHours();

        if (hour >= 8 && hour <= 18) {
          if (waveHeights[i] > 1.5 && wavePeriods[i] > 10) {
            consecutiveHours++;
            if (consecutiveHours >= 3) {
              goodConditionDetected = true;
              break; // No need to check further
            }
          } else {
            consecutiveHours = 0; // Reset count if conditions break
          }
        }
      }

      if (goodConditionDetected) {
        console.log(`🏄 ${location.name} has at least 3 consecutive hours of good surf.`);
        bestLocations.push({ name: location.name });
      }
    } catch (error) {
      console.error(`❌ Error fetching data for ${location.name}:`, error.message);
    }
  }

  if (bestLocations.length > 0) {
    console.log("🏄 Best Surf Locations Today:", bestLocations.map(loc => loc.name).join(", "));
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

// Cron-job call to wake backend up (Render backend spins-down after 15 mins)
app.get("/ping", (req, res) => {
  console.log("✅ Ping received from UptimeRobot");
  res.send("👍 Backend is alive");
});

// This will run once on project startup - The project is woken up once a day at 9:00 by cron-jobs (a ping sent to Render to wake the project up)
checkSurfConditions();

// Run surf check every 10 seconds (For testing)
//setInterval(checkSurfConditions, 10000);

// Start server
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});