const express = require("express");
const mammoth = require("mammoth");
const multer = require("multer");
const fileSystem = require("fs");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const { Server } = require("socket.io");
const http = require("http");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = 3000;

const mongoUri = "mongodb+srv://jbulian:3VS1WUkzqxzyushm@gorillafundercluster.v3levad.mongodb.net/";

// MongoDB connection
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Schema for Waitlist
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  platform: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const ViddeonUser = mongoose.model('Viddeon_Users', userSchema);

// Socket.IO maps and variables
const emailToSocketIdMap = new Map();
const socketidToEmailMap = new Map();
const onlineUsers = new Map();

// Socket.IO connection handling
// socket.on("room:join", (data) => {
//   const { email, room } = data;
//   emailToSocketIdMap.set(email, socket.id);
//   socketidToEmailMap.set(socket.id, email);
//   io.to(room).emit("user:joined", { email, id: socket.id });
//   socket.join(room);
//   io.to(socket.id).emit("room:join", data);
// });
io.on("connection", (socket) => {
  console.log(`Socket Connected`, socket.id);


  // socket.on("get-online-users", () => {
  //   console.log("get-online-users", Array.from(onlineUsers.entries()));
  //   io.emit('update-online-users', Array.from(onlineUsers.entries()));
  // });

  socket.on('user-online', (userId) => {
    console.log('user-just-online', userId);
    onlineUsers.set(userId, socket.id);
    io.emit('update-online-users', Array.from(onlineUsers.entries()));
    console.log("online-users", onlineUsers)
  });

  socket.on("start-video-call", (data) => {
    const { userId, socketId, offer, userName, isVideoCall } = data;
    const area = `${socket.id}-${socketId}`;
    console.log("start-video-call", data);
    console.log("current-socket-id", socket.id)
    socket.to(socketId).emit("incomming-call", { from: socket.id, userId, area, offer, userName, isVideoCall });
  });

  socket.on("call-declined", (data) => {
    const { socketId } = data;
    console.log("inside call-declined ", socketId);
    socket.to(socketId).emit("call-declined", {
      from: socket.id
    })
  })

  socket.on("call-accepted", (data) => {
    const { fromUserId, toSocketId, area, answer, isVideoCall } = data;
    console.log("call-accepted", data);
    socket.to(toSocketId).emit("call-accepted", { from: socket.id, fromUserId, area, answer, isVideoCall });
    io.sockets.sockets.get(toSocketId)?.join(area);
    socket.join(area);
    setTimeout(() => {
      console.log("just to emit notify");
      io.to(area).emit("notify", {
        message: `User ${fromUserId} accepted the call.`,
        fromSocketId: socket.id,
        fromUserId,
        isVideoCall,
        area,
        isVideoCall,
      });
    }, 4000);
  });

  socket.on("call-ended", (data) => {
    const { to, area } = data;
    console.log("call-ended", data);
    socket.to(to).emit("call-ended", { from: socket.id, area });
    io.sockets.sockets.get(to)?.leave(area);
    socket.leave(area);
  })

  socket.on("peer-nego-needed", (data) => {
    const { toSocketId, offer } = data;
    socket.to(toSocketId).emit("peer-nego-needed", { from: socket.id, offer });
  });

  socket.on("peer-nego-done", (data) => {
    const { to, answer } = data;
    socket.to(to).emit("peer-nego-final", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit("ice-candidate", { candidate });
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incomming:call", { from: socket.id, offer });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:nego:needed", ({ to, offer }) => {
    console.log("peer:nego:needed", offer);
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });

  socket.on("peer:nego:done", ({ to, ans }) => {
    console.log("peer:nego:done", ans);
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });
});

app.use(express.json({ limit: '100mb' })); // Increase the JSON body size limit
app.use(express.urlencoded({ limit: '100mb', extended: true })); // Increase URL-encoded body size limit
app.use(cors());

// Serve the 'uploads' directory as static files
app.use('/uploads', express.static('uploads'));

// Set up storage for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads"); // Set the directory where files will be saved
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Use the original file name
  },
});

// Increase the file size limit for multer
const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // Set file size limit to 100MB
});

app.post("/extract-text", upload.single("file"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send({ error: "Word file is required" });
  }
  const extension = file.originalname.split(".").pop();

  const filePath = req.file.path; // Get the path of the uploaded file

  if (extension == "docx" || extension == "doc") {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      res.send({ text: "Extracted text from Word", data: result.value });
      fileSystem.unlinkSync(filePath); // Delete the file after extracting text
    } catch (error) {
      console.error("Error extracting text from word:", error);
      res.status(500).send({ error: "Failed to extract text from Word" });
    }
  } else if (extension == "pdf") {
    try {
      const dataBuffer = fileSystem.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      res.send({ text: "Extracted text from PDF", data: pdfData.text });
      fileSystem.unlinkSync(filePath); // Delete the file after extracting text
    } catch (error) {
      console.error("Error extracting text from PDF:", error);
      res.status(500).send({ error: "Failed to extract text from PDF" });
    }
  } else {
    res.status(400).send({ error: "Invalid file format" });
  }
});

// New endpoint for uploading audio files
app.post("/upload-audio", upload.single("audio"), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send({ error: "Audio file is required" });
  }

  // Respond with the URL of the uploaded audio file
  res.send({ url: `https://helper.screnpla.com/uploads/${file.filename}` });
});

app.delete("/delete-audio/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = `./uploads/${filename}`;

  fileSystem.unlink(filePath, (err) => {
    if (err) {
      console.error("Error deleting file:", err);
      return res.status(500).send({ error: "Failed to delete file" });
    }
    res.send({ message: "File deleted successfully" });
  });
});

// Get all uploaded audios
app.get("/uploaded-audios", (req, res) => {
  const directoryPath = "./uploads";
  fileSystem.readdir(directoryPath, function (err, files) {
    if (err) {
      return console.log("Unable to scan directory: " + err);
    }
    res.send(files);
  });
});

// Waitlist API - Add user to waitlist
app.post("/waitlist", async (req, res) => {
  try {
    const { email, platform } = req.body;

    // Validate required fields
    if (!email || !platform) {
      return res.status(400).json({
        success: false,
        message: "Email and platform are required"
      });
    }

    // Check if user already exists
    const existingUser = await ViddeonUser.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User is already registered for the waitlist"
      });
    }

    // Create new user
    const newUser = new ViddeonUser({
      email,
      platform
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: "User successfully added to waitlist",
      user: {
        id: newUser._id,
        email: newUser.email,
        platform: newUser.platform,
        createdAt: newUser.createdAt
      }
    });

  } catch (error) {
    console.error("Error adding user to waitlist:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

// Get all waitlist users
app.get("/waitlist-users", async (req, res) => {
  try {
    const { platform } = req.query;

    // Build query based on platform parameter
    const query = platform ? { platform } : {};

    const users = await ViddeonUser.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      platform: platform || 'all',
      users: users
    });

  } catch (error) {
    console.error("Error fetching waitlist users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

app.get("/", (req, res) => {
  res.send("Hello World");
});

// Change app.listen to server.listen
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
