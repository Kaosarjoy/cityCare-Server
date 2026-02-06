const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Setup ---
// Make sure to download the service account key JSON file from Firebase Console
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// --------------------------------

//MidleWare
app.use(express.json());
app.use(cors());

//JWT Token Verification Middleware
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "invalid token" });
  }
};

//Mongodb URL
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uoqvvub.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper function to generate tracking ID
function generateTrackingId() {
  return "CITY-" + Date.now() + Math.floor(Math.random() * 1000);
}

// Helper function to add to timeline
async function addTimelineEntry(db, issueId, status, message, updatedBy) {
  const timelineCollection = db.collection("timelines");
  await timelineCollection.insertOne({
    issueId: new ObjectId(issueId),
    status,
    message,
    updatedBy,
    date: new Date(),
  });
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //all database
    const db = client.db("cityCare_DB");
    const userCollection = db.collection("users");
    const stafsCollection = db.collection("stafs");
    const issueCollection = db.collection("issues");
    const paymentsCollection = db.collection("payments");
    const timelineCollection = db.collection("timelines");

    //MIDDLEWARE FOR ADMIN ACCESS
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email; // Firebase decoded email
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // --- USERS API ---

    // Get all users with filtering/search for admin
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (
        searchText &&
        searchText !== "undefined" &&
        searchText.trim() !== ""
      ) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const result = await userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Register a new user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user exists", insertedId: null });
      }

      user.role = "user";
      user.status = "active"; // active/blocked
      user.createdAt = new Date();
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Update user role (admin)
    app.patch("/users/:id/role",verifyToken,verifyAdmin,async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: role,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // Block/Unblock user (admin)
    app.patch("/users/:id/status",verifyToken,verifyAdmin,async (req, res) => {
        const id = req.params.id;
        const { status } = req.body; // active or blocked
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user", status: user?.status || "active" });
    });

    // Get single user info
    app.get("/users/profile/:email", verifyToken, async (req, res) => {
        const email = req.params.email;
        const query = { email };
        const user = await userCollection.findOne(query);
        res.send(user);
    });

   // --- STAFF API ---

    // Get all staff (admin)
    app.get("/staffs", verifyToken, verifyAdmin, async (req, res) => {
      const result = await stafsCollection.find().toArray();
      res.send(result);
    });
   
    // Add new staff (admin)
    app.post("/staffs", verifyToken, verifyAdmin, async (req, res) => {
      const staffData = req.body;
      const result = await stafsCollection.insertOne(staffData);
      res.send(result);
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server side is on ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
