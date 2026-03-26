import mongoose from 'mongoose';
import config from './env.js';

const connectDB = async () => {
  try {
    mongoose.set('strictQuery', false);

    const conn = await mongoose.connect(config.MONGO_URI, {
      // These options are defaults in Mongoose 8 but kept explicit for clarity
      serverSelectionTimeoutMS: 10000, // give up trying to connect after 10s
      socketTimeoutMS: 45000,          // close sockets after 45s of inactivity
    });

    console.log(`[MongoDB] Connected: ${conn.connection.host} — db: ${conn.connection.name}`);

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Disconnected from database');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] Connection error:', err.message);
    });
  } catch (err) {
    console.error('[MongoDB] Initial connection failed:', err.message);
    process.exit(1);
  }
};

export default connectDB;
