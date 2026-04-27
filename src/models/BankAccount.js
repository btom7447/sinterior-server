import mongoose from 'mongoose';

// Bank account on file for a seller. Each row has a Paystack `recipient_code`
// (created via Paystack's createTransferRecipient API) which is what we hand
// to Paystack at payout time. The account name is verified against Paystack's
// bank/resolve before we let the user save — we don't trust user input.
const bankAccountSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    accountNumber: { type: String, required: true, trim: true, maxlength: 20 },
    accountName: { type: String, required: true, trim: true, maxlength: 200 },
    bankCode: { type: String, required: true, trim: true, maxlength: 10 },
    bankName: { type: String, required: true, trim: true, maxlength: 100 },
    paystackRecipientCode: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: Date.now },

    // Set when the resolved account name doesn't match the profile's
    // legal name closely enough. Admin can review these to catch sellers
    // routing payouts to third-party accounts (KYC/AML signal).
    nameMismatch: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One default per seller — we enforce this at the controller layer.
bankAccountSchema.index({ profileId: 1, accountNumber: 1, bankCode: 1 }, { unique: true });

const BankAccount = mongoose.model('BankAccount', bankAccountSchema);
export default BankAccount;
