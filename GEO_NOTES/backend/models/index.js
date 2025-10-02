import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

export const connectDB = async () => {
  const mongoUri =
    process.env.NODE_ENV === "production"
      ? process.env.MONGODB_URI
      : process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI;
  console.log("Connecting to MongoDB at:", mongoUri);
  mongoose.set("debug", true);
  await mongoose.connect(mongoUri);
  console.log("MongoDB connected successfully");
};

export { mongoose };
