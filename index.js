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
      // Update staff (admin)
    app.patch("/staffs/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedInfo = req.body;
      const result = await stafsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedInfo }
      );
      res.send(result);
    });
     // Delete staff (admin)
    app.delete("/staffs/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await stafsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    // --- ISSUES API ---

    // GET all issues with Pagination, Search, and Filtering
    app.get("/issues", async (req, res) => {
      const { email, status, category, priority, search, page = 1, limit = 10 } = req.query;
      const query = {};
      if (email) query.reporterEmail = email;
      if (status) query.status = status;
      if (category) query.category = category;
      if (priority) query.priority = priority;

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ];
      }

      // Pagination logic
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Sorting: Boosted items first, then by creation date
      const result = await issueCollection.find(query).sort({ priority: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit)).toArray();

      const totalIssues = await issueCollection.countDocuments(query);
      res.send({ result, totalIssues });
    });


    // GET issues assigned to staff
    app.get("/issues/staff/:email", verifyToken, async (req, res) => {
      const staffEmail = req.params.email;
      const { status } = req.query;
      const query = { stafEmail: staffEmail };
      if (status) query.status = status;

      const result = await issueCollection.find(query).toArray();
      res.send(result);
    });

    // GET single issue details
    app.get("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issueCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    // POST new issue (citizen)
    app.post("/issues", verifyToken, async (req, res) => {
      const issue = req.body;
      const userEmail = req.decoded.email;

      // Check user report limit
      const user = await userCollection.findOne({ email: userEmail });
      if (user.role !== 'admin' && user.subscription !== 'premium') {
          const userReportCount = await issueCollection.countDocuments({ reporterEmail: userEmail });
          if (userReportCount >= 3) {
              return res.status(403).send({ message: "Free limit reached. Please subscribe." });
          }
      }

      issue.createdAt = new Date();
      issue.trackingId = generateTrackingId();
      issue.paymentStatus = "unpaid";
      issue.status = "Pending";
      issue.priority = "Normal";
      issue.upvotes = 0;
      issue.votedUsers = [];

      const result = await issueCollection.insertOne(issue);
      
      // Add timeline entry
      await addTimelineEntry(db, result.insertedId, "Pending", `Issue reported by ${userEmail}`, userEmail);

      res.send(result);
    });

    // Patch issue status (Staff/Admin)
    app.patch("/issues/:id/status", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status, message } = req.body;
      const userEmail = req.decoded.email;

      const result = await issueCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: status } }
      );

      // Add timeline entry
      await addTimelineEntry(db, id, status, message, userEmail);
      res.send(result);
    });
     // Assign staff to issue (Admin)
    app.patch("/issues/:id/assign", verifyToken, verifyAdmin, async (req, res) => {
      const { staffName, staffEmail } = req.body;
      const id = req.params.id;

      const updateDoc = {
        $set: {
          stafName: staffName,
          stafEmail: staffEmail,
        },
      };

      const result = await issueCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );

      // Add timeline entry
      await addTimelineEntry(db, id, "Pending", `Assigned to Staff: ${staffName}`, req.decoded.email);
      res.send(result);
    });
    // Upvote issue (Citizen)
    app.patch("/issues/:id/upvote", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;
      
      const issue = await issueCollection.findOne({ _id: new ObjectId(id) });
      
      if (issue.reporterEmail === userEmail) {
          return res.status(400).send({ message: "Cannot upvote your own issue" });
      }

      if (issue.votedUsers && issue.votedUsers.includes(userEmail)) {
          return res.status(400).send({ message: "Already upvoted" });
      }

      const result = await issueCollection.updateOne(
          { _id: new ObjectId(id) },
          { 
              $inc: { upvotes: 1 },
              $push: { votedUsers: userEmail }
          }
      );
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


//https://docs.google.com/document/d/1IBsw4txo6JSav_MJNBsv5_spB0emiYVK/edit