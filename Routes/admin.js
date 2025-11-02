// routes/admin.js
import express from "express";
import mongoose from "mongoose";

import Regulation from "../Models/Regulation.js";
import Branch from "../Models/Branch.js";
import Subject from "../Models/Subject.js";
import Faculty from "../Models/Faculty.js";
import Note from "../Models/Note.js";

import { getDownloadURL, deleteFile } from "../utils/s3.js"; // S3 helpers
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Admin middleware
export const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

/* ------------------- REGULATION ROUTES ------------------- */
router.get(
  "/regulations",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const regs = await Regulation.find().sort({ createdAt: -1 });
      res.json(regs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/regulations",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { name, numberOfSemesters } = req.body;
      if (!name || !numberOfSemesters)
        return res
          .status(400)
          .json({ message: "Name and numberOfSemesters required" });
      const reg = new Regulation({ name, numberOfSemesters });
      const saved = await reg.save();
      res.status(201).json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.put(
  "/regulations/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      const updated = await Regulation.findByIdAndUpdate(id, req.body, {
        new: true,
      });
      if (!updated)
        return res.status(404).json({ message: "Regulation not found" });
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/regulations/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const regulation = await Regulation.findById(id).session(session);
      if (!regulation)
        return res.status(404).json({ message: "Regulation not found" });

      const notes = await Note.find({ regulation: id }).session(session);
      for (const note of notes) await deleteFile(note.fileKey);
      await Note.deleteMany({ regulation: id }).session(session);

      const branches = await Branch.find({ regulation: id }).session(session);
      for (const branch of branches) {
        const branchNotes = await Note.find({ branch: branch._id }).session(
          session
        );
        for (const note of branchNotes) await deleteFile(note.fileKey);
        await Note.deleteMany({ branch: branch._id }).session(session);

        const subjects = await Subject.find({ branch: branch._id }).session(
          session
        );
        for (const subject of subjects) {
          const subjectNotes = await Note.find({
            subject: subject._id,
          }).session(session);
          for (const note of subjectNotes) await deleteFile(note.fileKey);
          await Note.deleteMany({ subject: subject._id }).session(session);
        }

        await Subject.deleteMany({ branch: branch._id }).session(session);
      }

      await Branch.deleteMany({ regulation: id }).session(session);
      await Regulation.findByIdAndDelete(id).session(session);

      await session.commitTransaction();
      session.endSession();
      res.json({
        message:
          "Regulation and all related branches, subjects, and notes deleted successfully.",
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("Transaction failed:", err);
      res.status(500).json({ message: "Error during cascade delete" });
    }
  }
);

/* ------------------- BRANCH ROUTES ------------------- */
router.get("/branches", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const branches = await Branch.find().populate("regulation", "name");
    res.json(branches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/branches", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, code, regulation } = req.body;
    if (!name || !code || !regulation)
      return res.status(400).json({ message: "All fields required" });
    const branch = new Branch({ name, code, regulation });
    const saved = await branch.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put(
  "/branches/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      const updated = await Branch.findByIdAndUpdate(id, req.body, {
        new: true,
      });
      if (!updated)
        return res.status(404).json({ message: "Branch not found" });
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/branches/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const branch = await Branch.findById(id).session(session);
      if (!branch) return res.status(404).json({ message: "Branch not found" });

      const branchNotes = await Note.find({ branch: id }).session(session);
      for (const note of branchNotes) await deleteFile(note.fileKey);
      await Note.deleteMany({ branch: id }).session(session);

      await Subject.deleteMany({ branch: id }).session(session);
      await Branch.findByIdAndDelete(id).session(session);

      await session.commitTransaction();
      session.endSession();
      res.json({
        message: "Branch and related subjects/notes deleted successfully.",
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("Branch delete transaction failed:", err);
      res.status(500).json({ message: "Error deleting branch" });
    }
  }
);

/* ------------------- SUBJECT ROUTES ------------------- */
router.get("/subjects", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const subjects = await Subject.find()
      .populate("branch", "name")
      .sort({ createdAt: -1 });
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/subjects", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, code, branch, semester } = req.body;
    if (!name || !code || !branch || !semester)
      return res.status(400).json({ message: "All fields required" });
    const subject = new Subject({ name, code, branch, semester });
    const saved = await subject.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put(
  "/subjects/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });
      const updated = await Subject.findByIdAndUpdate(id, req.body, {
        new: true,
      });
      if (!updated)
        return res.status(404).json({ message: "Subject not found" });
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/subjects/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const subject = await Subject.findById(id).session(session);
      if (!subject)
        return res.status(404).json({ message: "Subject not found" });

      const notes = await Note.find({ subject: id }).session(session);
      for (const note of notes) await deleteFile(note.fileKey);
      await Note.deleteMany({ subject: id }).session(session);

      await Subject.findByIdAndDelete(id).session(session);

      await session.commitTransaction();
      session.endSession();
      res.json({ message: "Subject and related notes deleted successfully." });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("Subject delete transaction failed:", err);
      res.status(500).json({ message: "Error deleting subject" });
    }
  }
);

/* ------------------- FACULTY ROUTES ------------------- */
router.get("/faculty", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const faculty = await Faculty.find()
      .sort({ createdAt: -1 })
      .select("-password");
    res.json(faculty);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/faculty", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, email, password, employeeId, designation } = req.body;
    if (!name || !email || !password || !employeeId || !designation)
      return res.status(400).json({ message: "Required fields missing" });
    if (await Faculty.findOne({ email }))
      return res.status(400).json({ message: "Email already exists" });
    if (await Faculty.findOne({ employeeId }))
      return res.status(400).json({ message: "Employee ID already exists" });

    const bcrypt = await import("bcryptjs");
    const hashedPassword = await bcrypt.hash(password, 10);

    const faculty = new Faculty({
      name,
      email,
      password: hashedPassword,
      employeeId,
      designation,
    });
    const saved = await faculty.save();
    const savedWithoutPassword = saved.toObject();
    delete savedWithoutPassword.password;

    res.status(201).json(savedWithoutPassword);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put(
  "/faculty/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const { name, email, designation, password, employeeId } = req.body;
      const faculty = await Faculty.findById(id);
      if (!faculty)
        return res.status(404).json({ message: "Faculty not found" });

      if (email && email !== faculty.email) {
        const emailExists = await Faculty.findOne({ email, _id: { $ne: id } });
        if (emailExists)
          return res.status(400).json({ message: "Email already exists" });
        faculty.email = email;
      }

      if (employeeId && employeeId !== faculty.employeeId) {
        const empExists = await Faculty.findOne({
          employeeId,
          _id: { $ne: id },
        });
        if (empExists)
          return res
            .status(400)
            .json({ message: "Employee ID already exists" });
        faculty.employeeId = employeeId;
      }

      if (name) faculty.name = name;
      if (designation) faculty.designation = designation;
      if (password) {
        const bcrypt = await import("bcryptjs");
        faculty.password = await bcrypt.hash(password, 10);
      }

      const updated = await faculty.save();
      const updatedWithoutPassword = updated.toObject();
      delete updatedWithoutPassword.password;
      res.json(updatedWithoutPassword);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/faculty/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const deleted = await Faculty.findByIdAndDelete(id);
      if (!deleted)
        return res.status(404).json({ message: "Faculty not found" });

      res.json({ message: "Faculty deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/faculty/:id/uploads",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const faculty = await Faculty.findById(id).populate({
        path: "uploadedNotes",
        populate: [
          { path: "subject", select: "name code" },
          { path: "branch", select: "name" },
          { path: "regulation", select: "name" },
        ],
      });

      if (!faculty)
        return res.status(404).json({ message: "Faculty not found" });
      res.json(faculty.uploadedNotes || []);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ------------------- NOTES ROUTES ------------------- */
router.get("/notes", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { regulation, branch, semester, subject } = req.query;
    const filter = {};
    if (regulation) filter.regulation = regulation;
    if (branch) filter.branch = branch;
    if (semester) filter.semester = semester;
    if (subject) filter.subject = subject;

    const notes = await Note.find(filter, "-fileKey")
      .populate("regulation", "name")
      .populate("branch", "name")
      .populate("subject", "name code")
      .populate(
        "uploadedBy",
        "name email designation employeeId uploadedNotes"
      );

    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/notes/:id/file", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note || !note.fileKey)
      return res.status(404).json({ message: "File not found" });

    const fileUrl = await getDownloadURL(note.fileKey);
    res.json({ url: fileUrl }); // <-- return JSON with signed URL
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


router.delete(
  "/notes/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const note = await Note.findById(req.params.id);
      if (!note) return res.status(404).json({ message: "Note not found" });

      await deleteFile(note.fileKey);
      await Note.findByIdAndDelete(req.params.id);

      res.json({ message: "Note deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
