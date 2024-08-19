const express = require("express");
const mammoth = require("mammoth");
const multer = require("multer");
const fileSystem = require("fs");
const pdfParse = require("pdf-parse");
const cors = require("cors");

const app = express();
const port = 3000;

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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
