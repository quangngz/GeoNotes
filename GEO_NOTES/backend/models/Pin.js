import mongoose from "mongoose";

const PinSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    title: { type: String, required: true, maxlength: 120, trim: true },
    country: { type: String, maxlength: 80, trim: true },
    region: { type: String, maxlength: 80, trim: true },
    locationName: { type: String, maxlength: 120, trim: true },
    note: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

PinSchema.index({ user_id: 1, createdAt: -1 });
PinSchema.index({ latitude: 1, longitude: 1 }); // ← fix

export default mongoose.model("Pin", PinSchema);

// import mongoose from 'mongoose';

// const PinSchema = new mongoose.Schema({
//   latitude: {
//     type: Number,
//     required: true
//   },
//   longitude: {
//     type: Number,
//     required: true
//   },
//   note: {
//     type: String,
//     default: ''
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   },
//   updatedAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// // Update the updatedAt field before saving
// PinSchema.pre('save', function(next) {
//   this.updatedAt = Date.now();
//   next();
// });

// export default mongoose.model('Pin', PinSchema);