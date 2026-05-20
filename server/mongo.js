import mongoose from 'mongoose';

let connected = false;

export async function connectMongo() {
  if (connected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    connected = true;
    console.log('MongoDB → chat_db connected');
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
  }
}

export default mongoose;
