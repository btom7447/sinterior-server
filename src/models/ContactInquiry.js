import mongoose from 'mongoose';

const contactInquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, maxlength: 200 },
    topic: { type: String, trim: true, maxlength: 100 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    isResolved: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

const ContactInquiry = mongoose.model('ContactInquiry', contactInquirySchema);

export default ContactInquiry;
