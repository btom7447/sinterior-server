import mongoose from 'mongoose';
import config from './env.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connectDB = async () => {
  mongoose.set('strictQuery', false);

  const options = {
    serverSelectionTimeoutMS: 15000,  // give Atlas more time on cold starts
    socketTimeoutMS: 45000,           // close sockets after 45s of inactivity
    heartbeatFrequencyMS: 10000,      // check connection health every 10s
    retryWrites: true,
    retryReads: true,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(config.MONGO_URI, options);

      console.log(`[MongoDB] Connected: ${conn.connection.host} — db: ${conn.connection.name}`);

      mongoose.connection.on('disconnected', () => {
        console.warn('[MongoDB] Disconnected from database — Mongoose will auto-reconnect');
      });

      mongoose.connection.on('error', (err) => {
        console.error('[MongoDB] Connection error:', err.message);
      });

      return; // success — stop retrying
    } catch (err) {
      console.error(`[MongoDB] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);

      if (attempt < MAX_RETRIES) {
        console.log(`[MongoDB] Retrying in ${RETRY_DELAY_MS / 1000}s…`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error('[MongoDB] All connection attempts exhausted.');
        console.error('[MongoDB] Hint: check Atlas IP whitelist — add 0.0.0.0/0 to allow all IPs (or use Render static IP)');
        console.error('[MongoDB] Hint: also verify MONGO_URI is correct and Atlas cluster is running');
        process.exit(1);
      }
    }
  }
};

export default connectDB;
