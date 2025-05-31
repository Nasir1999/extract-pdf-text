const express = require("express");
const mammoth = require("mammoth");
const multer = require("multer");
const fileSystem = require("fs");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const { Server } = require("socket.io");
const http = require("http");
const { optimize } = require('svgo');
const axios = require('axios');
const app = express();
const { AuthClientTwoLegged, BucketsApi, ObjectsApi, DerivativesApi } = require('forge-apis');
const server = http.createServer(app);  
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = 4000;
const FORGE_CLIENT_ID = 'd5HTo88qrMOa1RPlwHl5A9HljG4bSuVsQxIJ2AElArnuMzo4'
const FORGE_CLIENT_SECRET = 'xmny3vhNTsSBc2rk4HVXyVtMGqzzX7PM7G1ItnWliftbuQUkbLzVBaLJYq5XHx2I'
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
    const { userId, socketId, offer, userName } = data;
    const area = `${socket.id}-${socketId}`;
    console.log("start-video-call", data);
    console.log("current-socket-id", socket.id)
    socket.to(socketId).emit("incomming-call", { from: socket.id, userId, area, offer, userName });
  });

  socket.on("call-accepted", (data) => {
    const { fromUserId, toSocketId, area, answer } = data;
    console.log("call-accepted", data);
    socket.to(toSocketId).emit("call-accepted", { from: socket.id, fromUserId, area, answer });
    io.sockets.sockets.get(toSocketId)?.join(area);
    socket.join(area);
    setTimeout(() => {
      console.log("just to emit notify");
      io.to(area).emit("notify", {
        message: `User ${fromUserId} accepted the call.`,
        fromSocketId: socket.id,
        fromUserId,
        area,
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

app.get("/", (req, res) => {
  res.send("Hello World");
});

// Change app.listen to server.listen
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

app.post('/convert-and-optimize', async (req, res) => {
  const { fileUrl } = req.body;
  console.log("fileUrl", fileUrl);
  try {
    // const svgRes = await axios.get(fileUrl);
    const svgRes = await axios.get(fileUrl, {
      responseType: 'text'
  });
    const originalSvg = svgRes.data;
    console.log("originalSvg", originalSvg);
    

    const result = optimize(originalSvg, {
      multipass: true,
      plugins: [
        'removeTitle',
        'removeDesc',
        'removeMetadata',
        'removeComments',
        'cleanupNumericValues',
        'convertPathData',
        'removeDimensions',
        'collapseGroups',
      ],
    });

    return res.send({ optimizedSvg: result.data });
  } catch (err) {
    console.error(err);
    return res.status(500).send({ error: 'Failed to optimize SVG' });
  }
});


const client = new AuthClientTwoLegged(
  process.env.FORGE_CLIENT_ID,
  process.env.FORGE_CLIENT_SECRET,
  ['data:read', 'data:write', 'data:create', 'bucket:create', 'viewables:read'],
  true
);


app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await client.authenticate();
    const buckets = new BucketsApi();
    const objects = new ObjectsApi();
    const derivatives = new DerivativesApi();

    const BUCKET_KEY = `your-bucket-${Date.now()}`.toLowerCase();

    // Create bucket
    await buckets.createBucket({ bucketKey: BUCKET_KEY, policyKey: 'transient' }, {}, token.credentials);

    // Upload file
    const fileStream = fs.createReadStream(req.file.path);
    const object = await objects.uploadObject(BUCKET_KEY, req.file.originalname, req.file.size, fileStream, {}, token.credentials);

    const urn = Buffer.from(object.body.objectId).toString('base64');

    // Start translation to SVF
    await derivatives.translate(
      {
        input: { urn },
        output: { formats: [{ type: 'svf', views: ['2d', '3d'] }] },
      },
      {},
      token.credentials
    );

    res.json({ urn });
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload failed');
  }
});