import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  try {
    const res = await fetch('http://localhost:3005/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password123' })
    });
    console.log('Login status:', res.status);
    const cookies = res.headers.get('set-cookie');
    console.log('Cookies:', cookies);

    if (cookies) {
      const createRes = await fetch('http://localhost:3005/api/rooms/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookies
        },
        body: JSON.stringify({ name: 'Test Room', topic: 'Math', is_public: true, access_mode: 'open' })
      });
      console.log('Create room status:', createRes.status);
      console.log('Create room body:', await createRes.text());
    }
  } catch(e) {
    console.error(e);
  }
}
run();
