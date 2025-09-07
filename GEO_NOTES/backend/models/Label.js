import mongoose from "mongoose";

const LabelSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, maxlength: 30, trim: true }
  },
  { timestamps: true }
);

LabelSchema.index({ user_id: 1, name: 1 }, { unique: true });

export default mongoose.model("Label", LabelSchema);