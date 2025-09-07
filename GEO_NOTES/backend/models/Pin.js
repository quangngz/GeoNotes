import mongoose from "mongoose";

const PinSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    // CHANGED: free-form string so we can support custom labels
    title: { type: String, maxlength: 80, trim: true},
    label: { type: String, maxlength: 30, trim: true, default: "General" },
    country: { type: String, maxlength: 80, trim: true },
    region: { type: String, maxlength: 80, trim: true },
    locationName: { type: String, maxlength: 120, trim: true },
    note: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

PinSchema.index({ user_id: 1, createdAt: -1 });
PinSchema.index({ latitude: 1, longitude: 1 });

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