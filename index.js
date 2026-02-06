const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//MidleWare
app.use(express.json());
app.use(cors());

//JWT Token
const UserVarifyToken = async (req, res, next) => {
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

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //all database
    const db = client.db("cityCare_DB");
    const userCollection = db.collection("users");
    const stafsCollection = db.collection("stafs");
    const issueCollection = db.collection("issues");

    //MIDDLEWARE FOR THE DATABASE ACCESS
    const VarifyCityCareAdmin = async (req, res, next) => {
      const email = req.decoded.email; //  Firebase decoded
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    //users api
    app.get("/users", UserVarifyToken, async (req, res) => {
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

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user exits", insertedId: null });
      }

      user.role = "user";
      user.createdAt = new Date();
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      UserVarifyToken,
      VarifyCityCareAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
      },
    );
    //ADmin

    app.patch("/users/admin/:email", async (req, res) => {
      const email = req.params.email;

      const result = await userCollection.updateOne(
        { email: email },
        { $set: { role: "admin" } },
      );

      res.send(result);
    });

    const adminEmail = "kaosarjoy52@gmail.com";

    await userCollection.updateOne(
      { email: adminEmail },
      { $set: { role: "admin" } },
      { upsert: true },
    );

    //User Role Management Api
    app.get("/users/:id", async (req, res) => {});

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);

      res.send({ role: user?.role || "user" });
    });

    //issues api
    //all data  issues can show the formate
    // GET all issues
    app.get("/issues", async (req, res) => {
      const query = {};
      const { email, solvedStatus } = req.query;

      if (email) {
        query.reporterEmail = email; // keep same as frontend
      }
      if (solvedStatus) {
        query.solvedStatus = solvedStatus;
      }

      const result = await issueCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // GET issues for staff
    app.get("/issues/staf", async (req, res) => {
      const { stafEmail, solvedStatus } = req.query;
      const query = {};
      if (stafEmail) query.stafEmail = stafEmail;
      if (solvedStatus) query.solvedStatus = solvedStatus;

      const result = await issueCollection.find(query).toArray();
      res.send(result);
    });

    // GET single issue
    app.get("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issueCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // PATCH assign staff to issue
    app.patch("/issues/:id", async (req, res) => {
      const { stafName, stafEmail, stafId } = req.body;
      const id = req.params.id;

      const updateDoc = {
        $set: {
          stafStatus: "staf_assign",
          stafId,
          stafEmail,
          stafName,
        },
      };

      const result = await issueCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc,
      );

      // Update staff workStatus
      if (stafId) {
        await stafsCollection.updateOne(
          { _id: new ObjectId(stafId) },
          { $set: { workStatus: "on-the-way" } },
        );
      }

      res.send(result);
    });

    // POST new issue
    app.post("/issues", async (req, res) => {
      const issue = req.body;

      issue.createdAt = new Date();
      issue.trackingId = generateTrackingId(); // your existing function
      issue.paymentStatus = "unpaid";
      issue.stafStatus = "pending";

      const result = await issueCollection.insertOne(issue);

      res.send({
        insertedId: result.insertedId,
        trackingId: issue.trackingId,
      });
    });

    // DELETE issue
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issueCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //  await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server side is on ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
