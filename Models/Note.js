import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  regulation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Regulation",
    required: true,
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subject",
    required: true,
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true,
  },
  semester: { type: String, required: true },
  // Remove old file buffer storage
  fileKey: { type: String, required: true }, // S3 object key
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Faculty",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

const Note = mongoose.model("Note", noteSchema);
export default Note;
