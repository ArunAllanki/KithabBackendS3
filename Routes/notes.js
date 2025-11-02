import express from "express";
import Note from "../Models/Note.js";
import Faculty from "../Models/Faculty.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUploadURLs, getDownloadURL, deleteS3Object } from "../utils/s3.js"; // utility to delete file
import JSZip from "jszip";

const router = express.Router();

// ------------------- 1. Generate presigned URLs -------------------
router.post("/upload", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "faculty")
      return res.status(403).json({ message: "Only faculty can upload notes" });

    const { filesMeta } = req.body;
    if (!filesMeta?.length)
      return res.status(400).json({ message: "No files metadata provided" });

    const filesWithKeys = filesMeta.map((f) => ({
      fileKey: `uploads/${Date.now()}_${f.originalName}`,
      originalName: f.originalName,
      fileType: f.fileType,
    }));

    const uploadUrls = await getUploadURLs(filesWithKeys);
    const filesToUpload = filesWithKeys.map((f, i) => ({
      ...f,
      uploadUrl: uploadUrls[i],
    }));

    res
      .status(200)
      .json({ message: "Upload URLs generated", files: filesToUpload });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ------------------- 2. Save note metadata -------------------
router.post("/save-notes", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "faculty")
      return res.status(403).json({ message: "Only faculty can save notes" });

    const { regulation, subject, branch, semester, uploadedFiles } = req.body;
    if (!uploadedFiles?.length)
      return res
        .status(400)
        .json({ message: "No successfully uploaded files" });

    const savedNotes = [];

    for (let file of uploadedFiles) {
      const newNote = new Note({
        title: file.originalName.replace(/\.[^/.]+$/, ""),
        regulation,
        subject,
        branch,
        semester,
        fileKey: file.fileKey,
        uploadedBy: req.user.id,
      });

      const savedNote = await newNote.save();

      await Faculty.findByIdAndUpdate(req.user.id, {
        $push: { uploadedNotes: savedNote._id },
      });

      savedNotes.push({
        _id: savedNote._id,
        title: savedNote.title,
        semester: savedNote.semester,
        branch,
        subject,
        regulation,
        fileKey: savedNote.fileKey,
      });
    }

    res.status(201).json({ message: "Notes saved successfully", savedNotes });
  } catch (err) {
    console.error("Save notes error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ------------------- 3. Get faculty's uploaded notes -------------------
router.get("/my-uploads", authMiddleware, async (req, res) => {
  try {
    const faculty = await Faculty.findById(req.user.id).populate({
      path: "uploadedNotes",
      options: { sort: { createdAt: -1 } }, // latest uploads first
      populate: [
        { path: "branch", select: "name" },
        { path: "subject", select: "name code" },
        { path: "regulation", select: "name" },
      ],
    });

    if (!faculty) return res.status(404).json({ message: "Faculty not found" });

    const notesWithUrl = await Promise.all(
      faculty.uploadedNotes.map(async (note) => ({
        _id: note._id,
        title: note.title,
        semester: note.semester,
        branch: note.branch,
        subject: note.subject,
        regulation: note.regulation,
        fileUrl: note.fileKey ? await getDownloadURL(note.fileKey) : null,
        fileKey: note.fileKey,
      }))
    );

    res.json(notesWithUrl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ------------------- 4. Delete note + remove from S3 -------------------
router.delete("/:id", authMiddleware, async (req, res) => {
  const noteId = req.params.id;

  try {
    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: "Note not found" });

    // Delete file from S3 if exists
    if (note.fileKey) {
      await deleteS3Object(note.fileKey); // utility function in s3.js
    }

    // Remove note from faculty uploadedNotes
    await Faculty.findByIdAndUpdate(note.uploadedBy, {
      $pull: { uploadedNotes: note._id },
    });

    // Delete note document
    await note.deleteOne();

    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
});

// ------------------- 5. Download multiple notes as ZIP -------------------
router.post("/download-zip", authMiddleware, async (req, res) => {
  try {
    const { noteIds } = req.body;
    if (!noteIds?.length)
      return res.status(400).json({ message: "No notes selected" });

    const notes = await Note.find({ _id: { $in: noteIds } });
    if (!notes.length)
      return res.status(404).json({ message: "Notes not found" });

    const zip = new JSZip();
    const filesData = await Promise.all(
      notes.map(async (note) => {
        if (!note.fileKey) return null;
        const fileUrl = await getDownloadURL(note.fileKey);
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        return { buffer, name: note.title + ".pdf" };
      })
    );

    filesData.forEach((f) => f && zip.file(f.name, Buffer.from(f.buffer)));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=notes.zip",
      "Content-Length": zipBuffer.length,
    });
    res.send(zipBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating ZIP", error: err.message });
  }
});

// ------------------- 6. Get notes by subject -------------------
router.get("/subject/:subjectId", async (req, res) => {
  const { subjectId } = req.params;

  try {
    // Find notes for the given subject
    const notes = await Note.find({ subject: subjectId })
      .populate("branch", "name")
      .populate("subject", "name code")
      .populate("regulation", "name")
      .populate("uploadedBy", "name email") // populate uploader info
      .sort({ createdAt: -1 }); // latest first

    if (!notes.length) {
      return res
        .status(404)
        .json({ message: "No notes found for this subject" });
    }

    // Map notes to include download URLs
    const notesWithUrl = await Promise.all(
      notes.map(async (note) => ({
        _id: note._id,
        title: note.title,
        semester: note.semester,
        branch: note.branch,
        subject: note.subject,
        regulation: note.regulation,
        uploadedBy: note.uploadedBy
          ? { _id: note.uploadedBy._id, name: note.uploadedBy.name }
          : null,
        createdAt: note.createdAt,
        fileUrl: note.fileKey ? await getDownloadURL(note.fileKey) : null,
        fileKey: note.fileKey,
      }))
    );

    res.status(200).json({ notes: notesWithUrl });
  } catch (err) {
    console.error("Fetch notes error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
