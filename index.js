const express = require("express");
var mammoth = require("mammoth");
const multer = require("multer");
const fileSystem = require("fs");

const app = express();
const port = 3000;

app.use(express.json());

// Set up storage for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads"); // Set the directory where files will be saved
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Use the original file name
  },
});

const upload = multer({ storage: storage });

app.post("/extract-text", upload.single("file"), async (req, res) => {
  //handle file upload
  const file = req.file;
  console.log("file", file)
  const extension = file.originalname.split(".").pop();

  if (!file) {
    return res.status(400).send({ error: "Word file is required" });
  }

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
      const module = await import("pdfjs-dist/legacy/build/pdf.mjs");
      var pdf = module.getDocument(filePath);
      pdf.promise.then(async function (data) {
        // number of pages
        var maxPages = data.numPages;
        var countPromises = []; // collecting all page promises
        for (var j = 1; j <= maxPages; j++) {
          var page = data.getPage(j);

          var txt = "";
          countPromises.push(
            page.then(function (page) {
              // add page promise
              var textContent = page.getTextContent();
              return textContent.then(function (text) {
                // return content promise
                return text.items
                  .map(function (s) {
                    return s.str;
                  })
                  .join(" "); // value page text
              });
            })
          );
        }
        // Wait for all pages and join text
        Promise.all(countPromises).then(function (texts) {
          // texts = texts.join(""); // we join all texts from all pages
          // console.log(texts);
          res.send({ text: "Extracted text from PDF", data: texts });
          fileSystem.unlinkSync(filePath); // Delete the file after extracting text
        });
      });
    } catch (error) {
      console.error("Error extracting text from PDF:", error);
      res.status(500).send({ error: "Failed to extract text from PDF" });
    }
  } else {
    res.status(400).send({ error: "Invalid file format" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
