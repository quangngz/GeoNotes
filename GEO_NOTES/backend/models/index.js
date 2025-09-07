import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
const { MONGO_URI } = process.env;

export const connectDB = async () => {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set in .env");
  }
  mongoose.set("debug", true); 
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected successfully");
};


export {mongoose}