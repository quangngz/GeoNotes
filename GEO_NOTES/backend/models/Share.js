import mongoose from "mongoose";

const ShareSchema = new mongoose.Schema(
  {
    owner_id:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["viewer", "editor"] }
  },
  { timestamps: true }
);

// Prevent duplicates
ShareSchema.index({ owner_id: 1, member_id: 1 }, { unique: true });

export default mongoose.model("Share", ShareSchema);