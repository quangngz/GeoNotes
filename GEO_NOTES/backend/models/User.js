import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password_hash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Fast lookup by email
UserSchema.index({ email: 1 }, { unique: true });

export default mongoose.model("User", UserSchema);